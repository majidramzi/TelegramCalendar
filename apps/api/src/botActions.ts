import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { prisma, type Event, type RsvpStatus } from "@tg-cal/db";
import {
  TELEGRAM_CAPTION_MAX,
  buildPersonalIcs,
  buildRsvpKeyboardRows,
  countsByOptionId,
  formatAnnouncement,
  normalizeRsvpOptions,
  photoExtension,
  resolveVoteOptionId,
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
  const minutesList = Array.isArray(event.remindBefore)
    ? event.remindBefore
    : [1440, 60];

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

function rsvpKeyboardForEvent(event: Event, counts: Record<string, number>) {
  const options = normalizeRsvpOptions(event.rsvpOptions);
  return {
    inline_keyboard: buildRsvpKeyboardRows(event.id, options, counts),
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

  const options = normalizeRsvpOptions(event.rsvpOptions);
  const counts = countsByOptionId(
    options,
    event.rsvps.map((r) => ({ optionId: r.optionId, status: r.status })),
  );
  const voters: AnnouncementVoter[] = [];
  for (const r of event.rsvps) {
    const optionId = resolveVoteOptionId(options, r.optionId, r.status);
    if (!optionId) continue;
    voters.push({
      optionId,
      displayName: r.displayName || `User ${r.userId.toString()}`,
    });
  }

  return { event, counts, voters, options };
}

async function deleteTelegramMessage(
  chatId: number,
  messageId: number | null | undefined,
): Promise<void> {
  if (!messageId) return;
  try {
    await telegramApi("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  } catch {
    // ignore
  }
}

function announcementBody(
  event: Event,
  timezone: string,
  voters: AnnouncementVoter[] | undefined,
  hasPhoto: boolean,
): string {
  return formatAnnouncement(event, timezone, {
    voters,
    maxLength: hasPhoto ? TELEGRAM_CAPTION_MAX : undefined,
  });
}

async function sendPhotoAnnouncement(
  chatId: number,
  event: Event,
  caption: string,
  keyboard: { inline_keyboard: { text: string; callback_data: string }[][] },
): Promise<number | null> {
  if (!event.photoData || !event.photoMime) return null;
  const bytes = Buffer.from(event.photoData);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append(
    "photo",
    new Blob([bytes], { type: event.photoMime }),
    `event.${photoExtension(event.photoMime)}`,
  );
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  form.append("reply_markup", JSON.stringify(keyboard));

  const res = await fetch(
    `https://api.telegram.org/bot${config.botToken()}/sendPhoto`,
    { method: "POST", body: form },
  );
  const data = (await res.json()) as {
    ok: boolean;
    result?: { message_id: number };
    description?: string;
  };
  if (!data.ok) {
    console.error("Failed to send event photo announcement", data.description);
    return null;
  }
  return data.result?.message_id ?? null;
}

export async function announceEvent(
  telegramChatId: bigint,
  event: Event,
  timezone: string,
): Promise<void> {
  const chatId = Number(telegramChatId);
  const options = normalizeRsvpOptions(event.rsvpOptions);
  const counts = countsByOptionId(options, []);
  const hasPhoto = Boolean(event.photoData && event.photoMime);
  const text = announcementBody(
    event,
    timezone,
    event.rsvpPublic ? [] : undefined,
    hasPhoto,
  );
  const keyboard = rsvpKeyboardForEvent(event, counts);

  let messageId: number | null = null;
  if (hasPhoto) {
    messageId = await sendPhotoAnnouncement(chatId, event, text, keyboard);
  }

  if (!messageId) {
    const data = await telegramApi("sendMessage", {
      chat_id: chatId,
      text: formatAnnouncement(event, timezone, {
        voters: event.rsvpPublic ? [] : undefined,
      }),
      parse_mode: "HTML",
      reply_markup: keyboard,
      disable_web_page_preview: true,
    });
    messageId = data.ok ? (data.result?.message_id ?? null) : null;
  }

  if (messageId) {
    await prisma.event.update({
      where: { id: event.id },
      data: {
        announcementMessageId: messageId,
        // Same message holds photo + caption + buttons.
        photoMessageId: hasPhoto ? messageId : null,
      },
    });
  }
}

/** Delete old announcement posts and publish a single new one (photo+text or text). */
export async function republishAnnouncement(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { chat: true },
  });
  if (!event) return;
  const chatId = Number(event.chat.telegramChatId);

  const ids = new Set<number>();
  if (event.announcementMessageId) ids.add(event.announcementMessageId);
  if (event.photoMessageId) ids.add(event.photoMessageId);
  for (const id of ids) {
    await deleteTelegramMessage(chatId, id);
  }

  await announceEvent(event.chat.telegramChatId, event, event.chat.timezone);
}

/** @deprecated use republishAnnouncement — kept for call sites. */
export async function syncAnnouncementPhoto(eventId: string): Promise<void> {
  await republishAnnouncement(eventId);
}

export async function refreshAnnouncement(eventId: string): Promise<void> {
  const ctx = await loadAnnouncementContext(eventId);
  if (!ctx?.event.announcementMessageId) return;

  const { event, counts, voters } = ctx;
  // photoMime means the live announcement is a photo+caption message.
  const hasPhoto = Boolean(event.photoMime);
  const text = announcementBody(
    event,
    event.chat.timezone,
    event.rsvpPublic ? voters : undefined,
    hasPhoto,
  );
  const keyboard = rsvpKeyboardForEvent(event, counts);
  const chatId = Number(event.chat.telegramChatId);

  if (hasPhoto) {
    const data = await telegramApi("editMessageCaption", {
      chat_id: chatId,
      message_id: event.announcementMessageId,
      caption: text,
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
    if (!data.ok) {
      console.error("Failed to refresh photo caption", data.description);
    }
    return;
  }

  await telegramApi("editMessageText", {
    chat_id: chatId,
    message_id: event.announcementMessageId,
    text,
    parse_mode: "HTML",
    reply_markup: keyboard,
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
