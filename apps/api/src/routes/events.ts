import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, PermissionMode, RsvpStatus } from "@tg-cal/db";
import { requireInitData, resolveChatFromStartParam } from "../auth.js";
import { isTelegramAdmin } from "../telegram.js";
import {
  announceEvent,
  cancelReminders,
  scheduleReminders,
} from "../botActions.js";
import type { EventDto } from "@tg-cal/shared";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable().optional(),
  allDay: z.boolean().optional(),
  location: z.string().max(500).nullable().optional(),
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
    createdBy: bigint;
    remindBefore: number[];
    rsvps?: { status: RsvpStatus; userId: bigint }[];
  },
  userId?: number,
): EventDto {
  const counts = { going: 0, maybe: 0, not_going: 0 };
  let myRsvp: EventDto["myRsvp"] = null;
  for (const r of event.rsvps ?? []) {
    counts[r.status] += 1;
    if (userId && r.userId === BigInt(userId)) myRsvp = r.status;
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
    createdBy: event.createdBy.toString(),
    remindBefore: event.remindBefore,
    rsvpCounts: counts,
    myRsvp,
  };
}

export async function eventsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireInitData);

  app.get("/chat", { preHandler: [resolveChatFromStartParam] }, async (req) => {
    const chat = req.chat!;
    return {
      id: chat.id,
      title: chat.title,
      type: chat.type,
      timezone: chat.timezone,
      permissionMode: chat.permissionMode,
    };
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
      const event = await prisma.event.create({
        data: {
          chatId: chat.id,
          title: data.title,
          description: data.description ?? null,
          startsAt: new Date(data.startsAt),
          endsAt: data.endsAt ? new Date(data.endsAt) : null,
          allDay: data.allDay ?? false,
          location: data.location ?? null,
          createdBy: BigInt(userId),
          remindBefore: data.remindBefore ?? [1440, 60],
        },
        include: { rsvps: true },
      });

      await scheduleReminders(event);
      await announceEvent(chat.telegramChatId, event, chat.timezone);

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
          remindBefore: data.remindBefore,
        },
        include: { rsvps: true },
      });

      await cancelReminders(event.id);
      await scheduleReminders(event);

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
      await prisma.rsvp.upsert({
        where: {
          eventId_userId: { eventId: id, userId: BigInt(userId) },
        },
        create: {
          eventId: id,
          userId: BigInt(userId),
          status: body.data.status as RsvpStatus,
        },
        update: { status: body.data.status as RsvpStatus },
      });

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
