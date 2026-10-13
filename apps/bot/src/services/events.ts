import { prisma, type Event, type RsvpStatus } from "@tg-cal/db";

export async function listUpcomingEvents(
  chatId: string,
  limit = 20,
): Promise<Event[]> {
  return prisma.event.findMany({
    where: {
      chatId,
      startsAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
    orderBy: { startsAt: "asc" },
    take: limit,
  });
}

export async function createEvent(input: {
  chatId: string;
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  allDay?: boolean;
  location?: string | null;
  createdBy: bigint;
  remindBefore?: number[];
}): Promise<Event> {
  return prisma.event.create({
    data: {
      chatId: input.chatId,
      title: input.title,
      description: input.description ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      allDay: input.allDay ?? false,
      location: input.location ?? null,
      createdBy: input.createdBy,
      remindBefore: input.remindBefore ?? [1440, 60],
    },
  });
}

export async function deleteEvent(eventId: string): Promise<Event | null> {
  try {
    return await prisma.event.delete({ where: { id: eventId } });
  } catch {
    return null;
  }
}

export async function getEvent(eventId: string) {
  return prisma.event.findUnique({
    where: { id: eventId },
    include: { chat: true, rsvps: true },
  });
}

export async function upsertRsvp(
  eventId: string,
  userId: bigint,
  status: RsvpStatus,
) {
  return prisma.rsvp.upsert({
    where: { eventId_userId: { eventId, userId } },
    create: { eventId, userId, status },
    update: { status },
  });
}

export async function rsvpCounts(eventId: string) {
  const rows = await prisma.rsvp.groupBy({
    by: ["status"],
    where: { eventId },
    _count: { _all: true },
  });
  const counts = { going: 0, maybe: 0, not_going: 0 };
  for (const row of rows) {
    counts[row.status] = row._count._all;
  }
  return counts;
}

export function formatEventLine(event: Event, timezone = "UTC"): string {
  const when = event.startsAt.toLocaleString("en-GB", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: event.allDay ? undefined : "short",
  });
  return `• *${escapeMd(event.title)}*\n  ${when}\n  \`${event.id.slice(0, 8)}\``;
}

function escapeMd(text: string): string {
  return text.replace(/([_*`\[])/g, "\\$1");
}
