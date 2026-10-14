import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, PermissionMode, Prisma, RsvpStatus } from "@tg-cal/db";
import { requireInitData, resolveChatFromStartParam } from "../auth.js";
import { isTelegramAdmin } from "../telegram.js";
import {
  announceEvent,
  cancelReminders,
  displayNameFromUser,
  refreshAnnouncement,
  scheduleReminders,
  sendPersonalCalendarInvite,
  syncAnnouncementPhoto,
} from "../botActions.js";
import { config } from "../config.js";
import {
  EVENT_EMOJI_CHOICES,
  RSVP_CLOSE_BEFORE_CHOICES,
  countsByOptionId,
  decodeEventPhotoBase64,
  icsStatusFromOption,
  isRsvpOpen,
  normalizeRsvpCloseBefore,
  normalizeRsvpOptions,
  parseLocationCoords,
  resolveVoteOptionId,
  type EventDto,
  type RsvpOption,
} from "@tg-cal/shared";

const emojiSet = new Set<string>(EVENT_EMOJI_CHOICES);

const rsvpOptionSchema = z.object({
  id: z.string().min(1).max(32),
  kind: z.enum(["yes", "no", "extra"]),
  label: z.string().min(1).max(40),
  emoji: z.string().min(1).max(8),
  order: z.number().int(),
});

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
  rsvpOptions: z.array(rsvpOptionSchema).optional(),
  rsvpCloseBeforeMinutes: z
    .number()
    .int()
    .refine((n): n is (typeof RSVP_CLOSE_BEFORE_CHOICES)[number] =>
      (RSVP_CLOSE_BEFORE_CHOICES as readonly number[]).includes(n),
    )
    .optional(),
  timezone: z.string().min(1).max(64).optional(),
  remindBefore: z.array(z.number().int().positive()).optional(),
  photoBase64: z.string().max(3_500_000).optional(),
  photoMime: z.string().max(64).optional(),
  clearPhoto: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

function photoUrlFor(eventId: string): string {
  return `${config.publicApiUrl().replace(/\/$/, "")}/api/events/${eventId}/photo`;
}

function resolvePhotoUpdate(data: {
  photoBase64?: string;
  photoMime?: string;
  clearPhoto?: boolean;
}):
  | { kind: "none" }
  | { kind: "clear" }
  | { kind: "set"; bytes: Uint8Array; mime: string }
  | { kind: "error"; message: string } {
  if (data.clearPhoto) return { kind: "clear" };
  if (data.photoBase64) {
    if (!data.photoMime) {
      return { kind: "error", message: "photoMime is required with photoBase64" };
    }
    const decoded = decodeEventPhotoBase64(data.photoBase64, data.photoMime);
    if ("error" in decoded) return { kind: "error", message: decoded.error };
    return { kind: "set", bytes: decoded.bytes, mime: decoded.mime };
  }
  return { kind: "none" };
}

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
    rsvpOptions?: unknown;
    rsvpCloseBeforeMinutes?: number;
    photoMime?: string | null;
    photoData?: Uint8Array | Buffer | null;
    createdBy: bigint;
    remindBefore: number[];
    rsvps?: {
      status: RsvpStatus;
      optionId?: string | null;
      userId: bigint;
      displayName?: string | null;
    }[];
  },
  userId?: number,
  options?: { canManage?: boolean },
): EventDto {
  const rsvpOptions = normalizeRsvpOptions(event.rsvpOptions);
  const rsvpCloseBeforeMinutes = normalizeRsvpCloseBefore(
    event.rsvpCloseBeforeMinutes,
  );
  const hasPhoto = Boolean(event.photoMime);
  const voteRows = (event.rsvps ?? []).map((r) => ({
    optionId: r.optionId ?? null,
    status: r.status,
  }));
  const counts = countsByOptionId(rsvpOptions, voteRows);
  let myRsvp: EventDto["myRsvp"] = null;
  let myOptionId: string | null = null;
  const rsvpVoters: Record<string, string[]> | undefined = event.rsvpPublic
    ? Object.fromEntries(rsvpOptions.map((o) => [o.id, [] as string[]]))
    : undefined;
  for (const r of event.rsvps ?? []) {
    const oid = resolveVoteOptionId(rsvpOptions, r.optionId, r.status);
    if (userId && r.userId === BigInt(userId)) {
      myRsvp = r.status;
      myOptionId = oid;
    }
    if (rsvpVoters && oid) {
      const name = r.displayName || `User ${r.userId.toString()}`;
      (rsvpVoters[oid] ??= []).push(name);
    }
  }
  const isCreator =
    userId !== undefined && event.createdBy === BigInt(userId);
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
    rsvpOptions,
    rsvpCloseBeforeMinutes,
    hasPhoto,
    photoUrl: hasPhoto ? photoUrlFor(event.id) : null,
    createdBy: event.createdBy.toString(),
    remindBefore: event.remindBefore,
    rsvpCounts: counts,
    rsvpVoters,
    myRsvp,
    myOptionId,
    canManage: options?.canManage ?? isCreator,
    rsvpOpen: isRsvpOpen(event.startsAt, rsvpCloseBeforeMinutes),
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
  // Photo URLs are loaded by <img> without Telegram headers — skip auth for them.
  app.addHook("preHandler", async (req, reply) => {
    const pathOnly = req.url.split("?")[0] ?? "";
    if (req.method === "GET" && /\/events\/[^/]+\/photo\/?$/.test(pathOnly)) {
      return;
    }
    await requireInitData(req, reply);
  });

  app.get("/chat", { preHandler: [resolveChatFromStartParam] }, async (req) => {
    const chat = req.chat!;
    const userId = req.tg!.user.id;
    const q = req.query as { timezone?: string };
    const timezone = q.timezone
      ? await syncChatTimezone(chat.id, q.timezone)
      : chat.timezone;
    const isAdmin = await isTelegramAdmin(
      chat.telegramChatId,
      userId,
      chat.id,
    );
    const canCreate =
      chat.permissionMode === PermissionMode.all_members || isAdmin;
    return {
      id: chat.id,
      title: chat.title,
      type: chat.type,
      timezone,
      permissionMode: chat.permissionMode,
      canCreate,
      isAdmin,
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

      const userId = req.tg!.user.id;
      const isAdmin = await isTelegramAdmin(
        chat.telegramChatId,
        userId,
        chat.id,
      );
      const events = await prisma.event.findMany({
        where,
        include: { rsvps: true },
        omit: { photoData: true },
        orderBy: { startsAt: "asc" },
        take: 200,
      });

      return {
        events: events.map((e) =>
          toDto(e, userId, {
            canManage: e.createdBy === BigInt(userId) || isAdmin,
          }),
        ),
      };
    },
  );

  app.get(
    "/events/:id",
    { preHandler: [resolveChatFromStartParam] },
    async (req, reply) => {
      const chat = req.chat!;
      const userId = req.tg!.user.id;
      const { id } = req.params as { id: string };
      const event = await prisma.event.findFirst({
        where: { id, chatId: chat.id },
        include: { rsvps: true },
        omit: { photoData: true },
      });
      if (!event) return reply.code(404).send({ error: "Not found" });
      const isAdmin = await isTelegramAdmin(
        chat.telegramChatId,
        userId,
        chat.id,
      );
      return {
        event: toDto(event, userId, {
          canManage: event.createdBy === BigInt(userId) || isAdmin,
        }),
      };
    },
  );

  app.get("/events/:id/photo", async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = await prisma.event.findUnique({
      where: { id },
      select: { photoData: true, photoMime: true },
    });
    if (!event?.photoData || !event.photoMime) {
      return reply.code(404).send({ error: "No photo" });
    }
    reply.header("Content-Type", event.photoMime);
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(Buffer.from(event.photoData));
  });

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
      const photo = resolvePhotoUpdate(data);
      if (photo.kind === "error") {
        return reply.code(400).send({ error: photo.message });
      }
      const startsAt = new Date(data.startsAt);
      let endsAt = data.endsAt ? new Date(data.endsAt) : null;
      if (endsAt && endsAt.getTime() < startsAt.getTime()) {
        return reply
          .code(400)
          .send({ error: "End time cannot be before start time" });
      }
      const timezone = await syncChatTimezone(chat.id, data.timezone);
      const coords = resolveCoords(data);
      const rsvpOptions = normalizeRsvpOptions(data.rsvpOptions);
      const event = await prisma.event.create({
        data: {
          chatId: chat.id,
          title: data.title,
          description: data.description ?? null,
          startsAt,
          endsAt,
          allDay: data.allDay ?? false,
          location: data.location ?? null,
          locationLat: coords.locationLat,
          locationLng: coords.locationLng,
          emoji: normalizeEmoji(data.emoji),
          rsvpPublic: data.rsvpPublic ?? true,
          rsvpLocked: data.rsvpLocked ?? false,
          rsvpOptions: rsvpOptions as unknown as Prisma.InputJsonValue,
          rsvpCloseBeforeMinutes: normalizeRsvpCloseBefore(
            data.rsvpCloseBeforeMinutes,
          ),
          ...(photo.kind === "set"
            ? {
                photoData: Buffer.from(photo.bytes),
                photoMime: photo.mime,
              }
            : {}),
          createdBy: BigInt(userId),
          remindBefore:
            data.remindBefore !== undefined ? data.remindBefore : [1440, 60],
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

      return { event: toDto(event, userId, { canManage: true }) };
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
      const nextStartsAt = data.startsAt
        ? new Date(data.startsAt)
        : existing.startsAt;
      const nextEndsAt =
        data.endsAt === undefined
          ? existing.endsAt
          : data.endsAt
            ? new Date(data.endsAt)
            : null;
      if (nextEndsAt && nextEndsAt.getTime() < nextStartsAt.getTime()) {
        return reply
          .code(400)
          .send({ error: "End time cannot be before start time" });
      }
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
      const photo = resolvePhotoUpdate(data);
      if (photo.kind === "error") {
        return reply.code(400).send({ error: photo.message });
      }
      const event = await prisma.event.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
          startsAt: data.startsAt ? nextStartsAt : undefined,
          endsAt:
            data.endsAt === undefined
              ? undefined
              : nextEndsAt,
          allDay: data.allDay,
          location: data.location,
          emoji: data.emoji !== undefined ? normalizeEmoji(data.emoji) : undefined,
          rsvpPublic: data.rsvpPublic,
          rsvpLocked: data.rsvpLocked,
          rsvpOptions:
            data.rsvpOptions !== undefined
              ? (normalizeRsvpOptions(
                  data.rsvpOptions,
                ) as unknown as Prisma.InputJsonValue)
              : undefined,
          rsvpCloseBeforeMinutes:
            data.rsvpCloseBeforeMinutes !== undefined
              ? normalizeRsvpCloseBefore(data.rsvpCloseBeforeMinutes)
              : undefined,
          ...(photo.kind === "set"
            ? {
                photoData: Buffer.from(photo.bytes),
                photoMime: photo.mime,
              }
            : photo.kind === "clear"
              ? { photoData: null, photoMime: null }
              : {}),
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
      if (photo.kind === "set" || photo.kind === "clear") {
        try {
          await syncAnnouncementPhoto(event.id);
        } catch (err) {
          req.log.error(err, "Failed to sync announcement photo");
        }
      }
      try {
        await refreshAnnouncement(event.id);
      } catch (err) {
        req.log.error(err, "Failed to refresh announcement");
      }

      return {
        event: toDto(event, userId, {
          canManage: isCreator || isAdmin,
        }),
      };
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
          optionId: z.string().min(1).max(32).optional(),
          status: z.enum(["going", "maybe", "not_going"]).optional(),
        })
        .safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: "Invalid vote" });
      }

      const event = await prisma.event.findFirst({
        where: { id, chatId: req.chat!.id },
      });
      if (!event) return reply.code(404).send({ error: "Not found" });

      const closeBefore = normalizeRsvpCloseBefore(
        event.rsvpCloseBeforeMinutes,
      );
      if (!isRsvpOpen(event.startsAt, closeBefore)) {
        const pastStart = Date.now() >= event.startsAt.getTime();
        return reply.code(409).send({
          error: pastStart
            ? "This event has already started — voting is closed."
            : "Voting deadline has passed for this event.",
        });
      }

      const options = normalizeRsvpOptions(event.rsvpOptions);
      let option: RsvpOption | undefined;
      if (body.data.optionId) {
        option = options.find((o) => o.id === body.data.optionId);
      } else if (body.data.status) {
        option =
          body.data.status === "going"
            ? options.find((o) => o.kind === "yes")
            : body.data.status === "not_going"
              ? options.find((o) => o.kind === "no")
              : options.find((o) => o.kind === "extra");
      }
      if (!option) {
        return reply.code(400).send({ error: "Invalid option" });
      }

      const userId = req.tg!.user.id;
      const name = displayNameFromUser(req.tg!.user);
      const nextStatus = icsStatusFromOption(option) as RsvpStatus;

      const existing = await prisma.rsvp.findUnique({
        where: {
          eventId_userId: { eventId: id, userId: BigInt(userId) },
        },
      });

      if (
        existing &&
        event.rsvpLocked &&
        existing.optionId !== option.id &&
        !(
          !existing.optionId &&
          existing.status === nextStatus &&
          option.kind !== "extra"
        )
      ) {
        const same =
          existing.optionId === option.id ||
          (!existing.optionId && existing.status === nextStatus);
        if (!same) {
          return reply.code(409).send({
            error:
              "This event locks the first vote — you cannot change it.",
          });
        }
      }

      const nextSequence = (existing?.icsSequence ?? 0) + 1;
      const changed =
        !existing ||
        existing.optionId !== option.id ||
        existing.status !== nextStatus;
      const rsvp = await prisma.rsvp.upsert({
        where: {
          eventId_userId: { eventId: id, userId: BigInt(userId) },
        },
        create: {
          eventId: id,
          userId: BigInt(userId),
          status: nextStatus,
          optionId: option.id,
          displayName: name,
          icsSequence: 1,
        },
        update: {
          status: nextStatus,
          optionId: option.id,
          displayName: name,
          icsSequence: nextSequence,
        },
      });

      try {
        await refreshAnnouncement(id);
      } catch (err) {
        req.log.error(err, "Failed to refresh announcement after RSVP");
      }

      if (changed) {
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
      const isAdmin = await isTelegramAdmin(
        req.chat!.telegramChatId,
        userId,
        req.chat!.id,
      );
      return {
        event: toDto(updated!, userId, {
          canManage: updated!.createdBy === BigInt(userId) || isAdmin,
        }),
      };
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
