import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { prisma, type Event } from "@tg-cal/db";
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

export async function announceEvent(
  telegramChatId: bigint,
  event: Event,
  timezone: string,
): Promise<void> {
  const when = event.startsAt.toLocaleString("en-GB", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: event.allDay ? undefined : "short",
  });
  const text = `📢 *New event*\n*${event.title.replace(/([_*\`[])/g, "\\$1")}*\n${when}`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ Going (0)", callback_data: `rsvp:${event.id}:going` },
        { text: "🤔 Maybe (0)", callback_data: `rsvp:${event.id}:maybe` },
      ],
      [{ text: "❌ No (0)", callback_data: `rsvp:${event.id}:not_going` }],
    ],
  };

  const res = await fetch(
    `https://api.telegram.org/bot${config.botToken()}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: Number(telegramChatId),
        text,
        parse_mode: "Markdown",
        reply_markup: keyboard,
      }),
    },
  );
  const data = (await res.json()) as {
    ok: boolean;
    result?: { message_id: number };
  };
  if (data.ok && data.result?.message_id) {
    await prisma.event.update({
      where: { id: event.id },
      data: { announcementMessageId: data.result.message_id },
    });
  }
}
