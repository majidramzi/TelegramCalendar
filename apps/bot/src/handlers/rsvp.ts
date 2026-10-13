import { prisma, RsvpStatus } from "@tg-cal/db";
import type { BotContext } from "../context.js";
import { upsertRsvp } from "../services/events.js";
import {
  refreshAnnouncementMessage,
  sendPersonalCalendarInvite,
} from "../services/announce.js";

const STATUS_MAP: Record<string, RsvpStatus> = {
  going: RsvpStatus.going,
  maybe: RsvpStatus.maybe,
  not_going: RsvpStatus.not_going,
};

function displayNameFromCtx(ctx: BotContext): string {
  const u = ctx.from;
  if (!u) return "Someone";
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (u.username) return `@${u.username}`;
  return `User ${u.id}`;
}

export async function handleRsvpCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const userId = ctx.from?.id;
  if (!data?.startsWith("rsvp:") || !userId) return;

  const parts = data.split(":");
  if (parts.length < 3) {
    await ctx.answerCallbackQuery({ text: "Invalid RSVP" });
    return;
  }

  const eventId = parts[1]!;
  const statusKey = parts.slice(2).join(":");
  const status = STATUS_MAP[statusKey];
  if (!status) {
    await ctx.answerCallbackQuery({ text: "Invalid status" });
    return;
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    await ctx.answerCallbackQuery({ text: "Event not found" });
    return;
  }

  const existing = await prisma.rsvp.findUnique({
    where: {
      eventId_userId: { eventId, userId: BigInt(userId) },
    },
  });

  if (existing && event.rsvpLocked && existing.status !== status) {
    await ctx.answerCallbackQuery({
      text: "This event locks the first RSVP — you cannot change your vote.",
      show_alert: true,
    });
    return;
  }

  if (existing && existing.status === status) {
    await ctx.answerCallbackQuery({ text: "Already recorded" });
    return;
  }

  const rsvp = await upsertRsvp(
    eventId,
    BigInt(userId),
    status,
    displayNameFromCtx(ctx),
  );
  await refreshAnnouncementMessage(ctx.api, eventId);
  await sendPersonalCalendarInvite(
    ctx.api,
    userId,
    event,
    status,
    rsvp.icsSequence,
  );

  const labels = {
    going: "Going",
    maybe: "Maybe",
    not_going: "Not going",
  } as const;

  await ctx.answerCallbackQuery({
    text: `RSVP: ${labels[status]} — calendar file sent in private chat`,
  });
}
