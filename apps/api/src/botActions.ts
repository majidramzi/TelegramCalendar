import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { prisma, type Event, type RsvpStatus } from "@tg-cal/db";
import {
  buildPersonalIcs,
  formatAnnouncement,
  type AnnouncementVoter,
  type PersonalIcsStatus,
} from "@tg-cal/shared";
import { config } from "./config.js";

let queue: Queue | null = null;

function getQueue(): Queue {
  if (!queue) {
    const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
    queue = new Queue("event-reminders", { connection });
  }
  return queue;
}

export async function scheduleReminders(event: Event): Promise<void> {
  const q = getQueue();
  const minutesList = event.remindBefore?.length ? event.remindBefore : [1440, 60];

  for (const minutesBefore of minutesList) {
    const fireAt = new Date(event.startsAt.getTime() - minutesBefore * 60_000);
    if (fireAt.getTime() <= Date.now()) continue;
    const jobId = `${event.id}-${minutesBefore}`;
    await prisma.reminderJob.upsert({
      where: { eventId_minutesBefore: { eventId: event.id, minutesBefore } },
      create: {
        eventId: event.id,
        minutesBefore,
        fireAt,
        bullJobId: jobId,
      },
      update: { fireAt, bullJobId: jobId, sentAt: null },
    });
    await q.add(
      "remind",
      { eventId: event.id, minutesBefore },
      { jobId, delay: fireAt.getTime() - Date.now(), removeOnComplete: true },
    );
  }
}

export async function cancelReminders(eventId: string): Promise<void> {
  const jobs = await prisma.reminderJob.findMany({ where: { eventId } });
  const q = getQueue();
  for (const job of jobs) {
    if (job.bullJobId) {
      try {
        await (await q.getJob(job.bullJobId))?.remove();
      } catch {
        // ignore
      }
    }
  }
  await prisma.reminderJob.deleteMany({ where: { eventId } });
}

async function telegramApi(method: string, body: Record<string, unknown>) {
  const res = await fetch(
    `https://api.telegram.org/bot${config.botToken()}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return (await res.json()) as {
    ok: boolean;
    result?: { message_id: number };
    description?: string;
  };
}

function rsvpKeyboard(
  eventId: string,
  counts: { going: number; maybe: number; not_going: number },
) {
  return {
    inline_keyboard: [
      [
        { text: `✅ Going (${counts.going})`, callback_data: `rsvp:${eventId}:going` },
        { text: `🤔 Maybe (${counts.maybe})`, callback_data: `rsvp:${eventId}:maybe` },
      ],
      [
        {
          text: `❌ No (${counts.not_going})`,
          callback_data: `rsvp:${eventId}:not_going`,
        },
      ],
    ],
  };
}

async function loadAnnouncementContext(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      chat: true,
      rsvps: true,
    },
  });
  if (!event) return null;

  const counts = { going: 0, maybe: 0, not_going: 0 };
  const voters: AnnouncementVoter[] = [];
  for (const r of event.rsvps) {
    counts[r.status] += 1;
    voters.push({
      status: r.status as AnnouncementVoter["status"],
      displayName: r.displayName || `User ${r.userId.toString()}`,
    });
  }

  return { event, counts, voters };
}

export async function announceEvent(
  telegramChatId: bigint,
  event: Event,
  timezone: string,
): Promise<void> {
  const text = formatAnnouncement(event, timezone, {
    voters: event.rsvpPublic ? [] : undefined,
  });
  const keyboard = rsvpKeyboard(event.id, {
    going: 0,
    maybe: 0,
    not_going: 0,
  });

  const data = await telegramApi("sendMessage", {
    chat_id: Number(telegramChatId),
    text,
    parse_mode: "HTML",
    reply_markup: keyboard,
    disable_web_page_preview: true,
  });

  if (data.ok && data.result?.message_id) {
    await prisma.event.update({
      where: { id: event.id },
      data: { announcementMessageId: data.result.message_id },
    });
  }
}

export async function refreshAnnouncement(eventId: string): Promise<void> {
  const ctx = await loadAnnouncementContext(eventId);
  if (!ctx?.event.announcementMessageId) return;

  const { event, counts, voters } = ctx;
  const text = formatAnnouncement(event, event.chat.timezone, {
    voters: event.rsvpPublic ? voters : undefined,
  });

  await telegramApi("editMessageText", {
    chat_id: Number(event.chat.telegramChatId),
    message_id: event.announcementMessageId,
    text,
    parse_mode: "HTML",
    reply_markup: rsvpKeyboard(event.id, counts),
    disable_web_page_preview: true,
  });
}

export async function sendPersonalCalendarInvite(options: {
  userId: bigint | number;
  event: Event;
  status: PersonalIcsStatus;
  sequence: number;
}): Promise<void> {
  const { userId, event, status, sequence } = options;
  const ics = buildPersonalIcs({
    event,
    userId,
    status,
    sequence,
  });

  const caption =
    status === "not_going"
      ? "Calendar update: open this file to remove/cancel the event on your phone."
      : status === "maybe"
        ? "Calendar update: open this file to save as tentative on your phone."
        : "Calendar update: open this file to add/update the event on your phone.";

  const form = new FormData();
  form.append("chat_id", String(userId));
  form.append(
    "document",
    new Blob([ics], { type: "text/calendar; charset=utf-8" }),
    `${event.title.replace(/[^\w.-]+/g, "_").slice(0, 40) || "event"}.ics`,
  );
  form.append("caption", caption);

  const res = await fetch(
    `https://api.telegram.org/bot${config.botToken()}/sendDocument`,
    { method: "POST", body: form },
  );
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) {
    console.error("Failed to send personal calendar file", data.description);
  }
}

export function displayNameFromUser(user: {
  first_name?: string;
  last_name?: string;
  username?: string;
  id: number;
}): string {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (user.username) return `@${user.username}`;
  return `User ${user.id}`;
}

export type { RsvpStatus };
