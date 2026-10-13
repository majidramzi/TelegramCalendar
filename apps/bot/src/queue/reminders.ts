import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { prisma, type Event } from "@tg-cal/db";
import { Bot } from "grammy";
import { config } from "../config.js";

const QUEUE_NAME = "event-reminders";

let connection: Redis | null = null;
let queue: Queue | null = null;

function getConnection(): Redis {
  if (!connection) {
    connection = new Redis(config.redisUrl(), {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}

export function getReminderQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: getConnection() });
  }
  return queue;
}

export async function scheduleRemindersForEvent(event: Event): Promise<void> {
  const q = getReminderQueue();
  const minutesList = event.remindBefore?.length
    ? event.remindBefore
    : [1440, 60];

  for (const minutesBefore of minutesList) {
    const fireAt = new Date(event.startsAt.getTime() - minutesBefore * 60_000);
    if (fireAt.getTime() <= Date.now()) continue;

    const delay = fireAt.getTime() - Date.now();
    const jobId = `${event.id}-${minutesBefore}`;

    await prisma.reminderJob.upsert({
      where: {
        eventId_minutesBefore: { eventId: event.id, minutesBefore },
      },
      create: {
        eventId: event.id,
        minutesBefore,
        fireAt,
        bullJobId: jobId,
      },
      update: {
        fireAt,
        bullJobId: jobId,
        sentAt: null,
      },
    });

    await q.add(
      "remind",
      { eventId: event.id, minutesBefore },
      {
        jobId,
        delay,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }
}

export async function cancelRemindersForEvent(eventId: string): Promise<void> {
  const jobs = await prisma.reminderJob.findMany({ where: { eventId } });
  const q = getReminderQueue();
  for (const job of jobs) {
    if (job.bullJobId) {
      try {
        const existing = await q.getJob(job.bullJobId);
        await existing?.remove();
      } catch {
        // ignore
      }
    }
  }
  await prisma.reminderJob.deleteMany({ where: { eventId } });
}

interface ReminderPayload {
  eventId: string;
  minutesBefore: number;
}

async function processReminder(job: Job<ReminderPayload>): Promise<void> {
  const { eventId, minutesBefore } = job.data;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { chat: true },
  });
  if (!event) return;

  const when = event.startsAt.toLocaleString("en-GB", {
    timeZone: event.chat.timezone,
    dateStyle: "medium",
    timeStyle: event.allDay ? undefined : "short",
  });

  const label =
    minutesBefore >= 1440
      ? `${Math.round(minutesBefore / 1440)} day(s)`
      : minutesBefore >= 60
        ? `${Math.round(minutesBefore / 60)} hour(s)`
        : `${minutesBefore} minute(s)`;

  const bot = new Bot(config.botToken());
  try {
    await bot.api.sendMessage(
      Number(event.chat.telegramChatId),
      `⏰ Reminder (${label} before)\n*${event.title}*\n${when}`,
      { parse_mode: "Markdown" },
    );
  } finally {
    await bot.stop();
  }

  await prisma.reminderJob.updateMany({
    where: { eventId, minutesBefore },
    data: { sentAt: new Date() },
  });
}

export function startReminderWorker(): Worker {
  const worker = new Worker<ReminderPayload>(
    QUEUE_NAME,
    processReminder,
    { connection: getConnection() },
  );

  worker.on("failed", (job, err) => {
    console.error(`Reminder job ${job?.id} failed`, err);
  });

  return worker;
}

/** Re-queue pending reminders after restart */
export async function restorePendingReminders(): Promise<void> {
  try {
    const pending = await prisma.reminderJob.findMany({
      where: {
        sentAt: null,
        fireAt: { gt: new Date() },
      },
      include: { event: true },
    });

    const q = getReminderQueue();
    for (const row of pending) {
      const delay = row.fireAt.getTime() - Date.now();
      if (delay <= 0) continue;
      // BullMQ custom ids cannot contain ":" (legacy rows may still have it)
      const jobId = (
        row.bullJobId ?? `${row.eventId}-${row.minutesBefore}`
      ).replaceAll(":", "-");
      if (row.bullJobId && row.bullJobId !== jobId) {
        await prisma.reminderJob.update({
          where: { id: row.id },
          data: { bullJobId: jobId },
        });
      }
      try {
        const existing = await q.getJob(jobId);
        if (existing) continue;
        await q.add(
          "remind",
          { eventId: row.eventId, minutesBefore: row.minutesBefore },
          { jobId, delay, removeOnComplete: true, removeOnFail: 100 },
        );
      } catch (err) {
        console.error(`Failed to restore reminder ${jobId}`, err);
      }
    }
  } catch (err) {
    console.error("restorePendingReminders failed", err);
  }
}
