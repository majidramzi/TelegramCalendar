import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, PermissionMode, RsvpStatus } from "@tg-cal/db";
import { requireInitData, resolveChatFromStartParam } from "../auth.js";
import { isTelegramAdmin } from "../telegram.js";
import {
  announceEvent,
  cancelReminders,
  displayNameFromUser,
  refreshAnnouncement,
  scheduleReminders,
  sendPersonalCalendarInvite,
} from "../botActions.js";
import {
  EVENT_EMOJI_CHOICES,
  parseLocationCoords,
  type EventDto,
  type RsvpStatus as SharedRsvpStatus,
} from "@tg-cal/shared";

const emojiSet = new Set<string>(EVENT_EMOJI_CHOICES);

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable().optional(),
  allDay: z.boolean().optional(),
  location: z.string().max(500).nullable().optional(),
  locationLat: z.number().min(-90).max(90).nullable().optional(),
  locationLng: z.number().min(-180).max(180).nullable().optional(),
  emoji: z.string().min(1).max(8).optional(),
  rsvpPublic: z.boolean().optional(),
  rsvpLocked: z.boolean().optional(),
  timezone: z.string().min(1).max(64).optional(),
  remindBefore: z.array(z.number().int().positive()).optional(),
});

const updateSchema = createSchema.partial();

function toDto(
  event: {
    id: string;
    chatId: string;
    title: string;
    description: string | null;
    startsAt: Date;
    endsAt: Date | null;
    allDay: boolean;
    location: string | null;
    locationLat: number | null;
    locationLng: number | null;
    emoji: string;
    rsvpPublic: boolean;
    rsvpLocked: boolean;
    createdBy: bigint;
    remindBefore: number[];
    rsvps?: {
      status: RsvpStatus;
      userId: bigint;
      displayName?: string | null;
    }[];
  },
  userId?: number,
): EventDto {
  const counts = { going: 0, maybe: 0, not_going: 0 };
  let myRsvp: EventDto["myRsvp"] = null;
  const rsvpVoters: Partial<Record<SharedRsvpStatus, string[]>> | undefined =
    event.rsvpPublic ? { going: [], maybe: [], not_going: [] } : undefined;
  for (const r of event.rsvps ?? []) {
    counts[r.status] += 1;
    if (userId && r.userId === BigInt(userId)) myRsvp = r.status;
    if (rsvpVoters) {
      const name = r.displayName || `User ${r.userId.toString()}`;
      rsvpVoters[r.status as SharedRsvpStatus]!.push(name);
    }
  }
  return {
    id: event.id,
    chatId: event.chatId,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString() ?? null,
    allDay: event.allDay,
    location: event.location,
    locationLat: event.locationLat,
    locationLng: event.locationLng,
    emoji: event.emoji || "📢",
    rsvpPublic: event.rsvpPublic,
    rsvpLocked: event.rsvpLocked,
    createdBy: event.createdBy.toString(),
    remindBefore: event.remindBefore,
    rsvpCounts: counts,
    rsvpVoters,
    myRsvp,
  };
}

function normalizeEmoji(value: string | undefined): string {
  if (!value) return "📢";
  return emojiSet.has(value) ? value : "📢";
}

function resolveCoords(data: {
  location?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
}): { locationLat: number | null; locationLng: number | null } {
  if (
    data.locationLat != null &&
    data.locationLng != null &&
    Number.isFinite(data.locationLat) &&
    Number.isFinite(data.locationLng)
  ) {
    return { locationLat: data.locationLat, locationLng: data.locationLng };
  }
  const parsed = parseLocationCoords(data.location);
  if (parsed) return { locationLat: parsed.lat, locationLng: parsed.lng };
  return { locationLat: null, locationLng: null };
}

async function syncChatTimezone(
  chatId: string,
  timezone: string | undefined,
): Promise<string> {
  if (!timezone) {
    const chat = await prisma.chat.findUniqueOrThrow({ where: { id: chatId } });
    return chat.timezone;
  }
  try {
    // Validate IANA timezone
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    const chat = await prisma.chat.findUniqueOrThrow({ where: { id: chatId } });
    return chat.timezone;
  }
  const updated = await prisma.chat.update({
    where: { id: chatId },
    data: { timezone },
  });
  return updated.timezone;
}

export async function eventsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireInitData);

  app.get("/chat", { preHandler: [resolveChatFromStartParam] }, async (req) => {
    const chat = req.chat!;
    const q = req.query as { timezone?: string };
    const timezone = q.timezone
      ? await syncChatTimezone(chat.id, q.timezone)
      : chat.timezone;
    return {
      id: chat.id,
      title: chat.title,
      type: chat.type,
      timezone,
      permissionMode: chat.permissionMode,
    };
  });

  app.patch("/chat/timezone", { preHandler: [resolveChatFromStartParam] }, async (req, reply) => {
    const body = z
      .object({ timezone: z.string().min(1).max(64) })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid timezone" });
    }
    const timezone = await syncChatTimezone(req.chat!.id, body.data.timezone);
    return { timezone };
  });

  app.get(
    "/events",
    { preHandler: [resolveChatFromStartParam] },
    async (req) => {
      const chat = req.chat!;
      const q = req.query as { from?: string; to?: string; upcoming?: string };
      const where: {
        chatId: string;
        startsAt?: { gte?: Date; lte?: Date };
      } = { chatId: chat.id };

      if (q.upcoming === "1") {
        where.startsAt = { gte: new Date(Date.now() - 60 * 60_000) };
      } else if (q.from || q.to) {
        where.startsAt = {};
        if (q.from) where.startsAt.gte = new Date(q.from);
        if (q.to) where.startsAt.lte = new Date(q.to);
      }

      const events = await prisma.event.findMany({
        where,
        include: { rsvps: true },
        orderBy: { startsAt: "asc" },
        take: 200,
      });

      return {
        events: events.map((e) => toDto(e, req.tg!.user.id)),
      };
    },
  );

  app.get(
    "/events/:id",
    { preHandler: [resolveChatFromStartParam] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const event = await prisma.event.findFirst({
        where: { id, chatId: req.chat!.id },
        include: { rsvps: true },
      });
      if (!event) return reply.code(404).send({ error: "Not found" });
      return { event: toDto(event, req.tg!.user.id) };
    },
  );

  app.post(
    "/events",
    { preHandler: [resolveChatFromStartParam] },
    async (req, reply) => {
      const chat = req.chat!;
      const userId = req.tg!.user.id;
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const canWrite =
        chat.permissionMode === PermissionMode.all_members ||
        (await isTelegramAdmin(chat.telegramChatId, userId, chat.id));
      if (!canWrite) {
        return reply
          .code(403)
          .send({ error: "Only admins can create events in this chat" });
      }

      const data = parsed.data;
      const timezone = await syncChatTimezone(chat.id, data.timezone);
      const coords = resolveCoords(data);
      const event = await prisma.event.create({
        data: {
          chatId: chat.id,
          title: data.title,
          description: data.description ?? null,
          startsAt: new Date(data.startsAt),
          endsAt: data.endsAt ? new Date(data.endsAt) : null,
          allDay: data.allDay ?? false,
          location: data.location ?? null,
          locationLat: coords.locationLat,
          locationLng: coords.locationLng,
          emoji: normalizeEmoji(data.emoji),
          rsvpPublic: data.rsvpPublic ?? true,
          rsvpLocked: data.rsvpLocked ?? false,
          createdBy: BigInt(userId),
          remindBefore: data.remindBefore ?? [1440, 60],
        },
        include: { rsvps: true },
      });

      try {
        await scheduleReminders(event);
      } catch (err) {
        req.log.error(err, "Failed to schedule reminders");
      }
      try {
        await announceEvent(chat.telegramChatId, event, timezone);
      } catch (err) {
        req.log.error(err, "Failed to announce event");
      }

      return { event: toDto(event, userId) };
    },
  );

  app.patch(
    "/events/:id",
    { preHandler: [resolveChatFromStartParam] },
    async (req, reply) => {
      const chat = req.chat!;
      const userId = req.tg!.user.id;
      const { id } = req.params as { id: string };
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const existing = await prisma.event.findFirst({
        where: { id, chatId: chat.id },
      });
      if (!existing) return reply.code(404).send({ error: "Not found" });

      const isCreator = existing.createdBy === BigInt(userId);
      const isAdmin = await isTelegramAdmin(
        chat.telegramChatId,
        userId,
        chat.id,
      );
      const canWrite =
        isCreator ||
        isAdmin ||
        chat.permissionMode === PermissionMode.all_members;
      if (!canWrite) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const data = parsed.data;
      if (data.timezone) {
        await syncChatTimezone(chat.id, data.timezone);
      }
      let coords: { locationLat: number | null; locationLng: number | null } | null =
        null;
      if (data.locationLat !== undefined || data.locationLng !== undefined) {
        coords =
          data.locationLat != null && data.locationLng != null
            ? {
                locationLat: data.locationLat,
                locationLng: data.locationLng,
              }
            : { locationLat: null, locationLng: null };
      } else if (data.location !== undefined) {
        coords = resolveCoords({ location: data.location });
      }
      const event = await prisma.event.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
          startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
          endsAt:
            data.endsAt === undefined
              ? undefined
              : data.endsAt
                ? new Date(data.endsAt)
                : null,
          allDay: data.allDay,
          location: data.location,
          emoji: data.emoji !== undefined ? normalizeEmoji(data.emoji) : undefined,
          rsvpPublic: data.rsvpPublic,
          rsvpLocked: data.rsvpLocked,
          ...(coords
            ? {
                locationLat: coords.locationLat,
                locationLng: coords.locationLng,
              }
            : {}),
          remindBefore: data.remindBefore,
        },
        include: { rsvps: true },
      });

      try {
        await cancelReminders(event.id);
        await scheduleReminders(event);
      } catch (err) {
        req.log.error(err, "Failed to reschedule reminders");
      }

      return { event: toDto(event, userId) };
    },
  );

  app.delete(
    "/events/:id",
    { preHandler: [resolveChatFromStartParam] },
    async (req, reply) => {
      const chat = req.chat!;
      const userId = req.tg!.user.id;
      const { id } = req.params as { id: string };

      const existing = await prisma.event.findFirst({
        where: { id, chatId: chat.id },
      });
      if (!existing) return reply.code(404).send({ error: "Not found" });

      const isCreator = existing.createdBy === BigInt(userId);
      const isAdmin = await isTelegramAdmin(
        chat.telegramChatId,
        userId,
        chat.id,
      );
      if (!isCreator && !isAdmin) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      await cancelReminders(id);
      await prisma.event.delete({ where: { id } });
      return { ok: true };
    },
  );

  app.post(
    "/events/:id/rsvp",
    { preHandler: [resolveChatFromStartParam] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({
          status: z.enum(["going", "maybe", "not_going"]),
        })
        .safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: "Invalid status" });
      }

      const event = await prisma.event.findFirst({
        where: { id, chatId: req.chat!.id },
      });
      if (!event) return reply.code(404).send({ error: "Not found" });

      const userId = req.tg!.user.id;
      const name = displayNameFromUser(req.tg!.user);
      const nextStatus = body.data.status as RsvpStatus;

      const existing = await prisma.rsvp.findUnique({
        where: {
          eventId_userId: { eventId: id, userId: BigInt(userId) },
        },
      });

      if (existing && event.rsvpLocked && existing.status !== nextStatus) {
        return reply.code(409).send({
          error: "This event locks the first RSVP — you cannot change your vote.",
        });
      }

      const nextSequence = (existing?.icsSequence ?? 0) + 1;
      const rsvp = await prisma.rsvp.upsert({
        where: {
          eventId_userId: { eventId: id, userId: BigInt(userId) },
        },
        create: {
          eventId: id,
          userId: BigInt(userId),
          status: nextStatus,
          displayName: name,
          icsSequence: 1,
        },
        update: {
          status: nextStatus,
          displayName: name,
          icsSequence: nextSequence,
        },
      });

      try {
        await refreshAnnouncement(id);
      } catch (err) {
        req.log.error(err, "Failed to refresh announcement after RSVP");
      }

      if (!existing || existing.status !== nextStatus) {
        try {
          await sendPersonalCalendarInvite({
            userId,
            event,
            status: nextStatus,
            sequence: rsvp.icsSequence,
          });
        } catch (err) {
          req.log.error(err, "Failed to send personal calendar file");
        }
      }

      const updated = await prisma.event.findUnique({
        where: { id },
        include: { rsvps: true },
      });
      return { event: toDto(updated!, userId) };
    },
  );

  app.post(
    "/admin-cache",
    { preHandler: [resolveChatFromStartParam] },
    async (req) => {
      // Bot can push admin cache; Mini App may call after bot confirms.
      // For now accept self-declared role only when body includes role from trusted bot later.
      // Placeholder: refresh own cache entry as "member".
      const userId = req.tg!.user.id;
      await prisma.chatAdminCache.upsert({
        where: {
          chatId_userId: {
            chatId: req.chat!.id,
            userId: BigInt(userId),
          },
        },
        create: {
          chatId: req.chat!.id,
          userId: BigInt(userId),
          role: "member",
        },
        update: { checkedAt: new Date() },
      });
      return { ok: true };
    },
  );
}
