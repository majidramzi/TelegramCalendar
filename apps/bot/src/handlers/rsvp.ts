import { prisma, RsvpStatus } from "@tg-cal/db";
import {
  icsStatusFromOption,
  isRsvpOpen,
  normalizeRsvpCloseBefore,
  normalizeRsvpOptions,
} from "@tg-cal/shared";
import type { BotContext } from "../context.js";
import { upsertRsvp } from "../services/events.js";
import {
  refreshAnnouncementMessage,
  sendPersonalCalendarInvite,
} from "../services/announce.js";

const LEGACY_STATUS: Record<string, RsvpStatus> = {
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
    await ctx.answerCallbackQuery({ text: "Invalid option" });
    return;
  }

  const eventId = parts[1]!;
  const optionKey = parts.slice(2).join(":");

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    await ctx.answerCallbackQuery({ text: "Event not found" });
    return;
  }

  const closeBefore = normalizeRsvpCloseBefore(event.rsvpCloseBeforeMinutes);
  if (!isRsvpOpen(event.startsAt, closeBefore)) {
    const pastStart = Date.now() >= event.startsAt.getTime();
    await ctx.answerCallbackQuery({
      text: pastStart
        ? "This event has already started — voting is closed."
        : "Voting deadline has passed for this event.",
      show_alert: true,
    });
    return;
  }

  const options = normalizeRsvpOptions(event.rsvpOptions);
  let option = options.find((o) => o.id === optionKey);
  if (!option && LEGACY_STATUS[optionKey]) {
    // Legacy callbacks from older announcements
    const legacy = LEGACY_STATUS[optionKey]!;
    option =
      legacy === RsvpStatus.going
        ? options.find((o) => o.kind === "yes")
        : legacy === RsvpStatus.not_going
          ? options.find((o) => o.kind === "no")
          : options.find((o) => o.kind === "extra");
  }
  if (!option) {
    await ctx.answerCallbackQuery({ text: "Invalid option" });
    return;
  }

  const status = icsStatusFromOption(option) as RsvpStatus;
  const existing = await prisma.rsvp.findUnique({
    where: {
      eventId_userId: { eventId, userId: BigInt(userId) },
    },
  });

  if (
    existing &&
    event.rsvpLocked &&
    (existing.optionId ?? existing.status) !== option.id &&
    existing.optionId !== option.id &&
    existing.status !== status
  ) {
    // Locked: block if already voted for a different option
    const same =
      existing.optionId === option.id ||
      (!existing.optionId && existing.status === status);
    if (!same) {
      await ctx.answerCallbackQuery({
        text: "This event locks the first vote — you cannot change it.",
        show_alert: true,
      });
      return;
    }
  }

  if (existing?.optionId === option.id) {
    await ctx.answerCallbackQuery({ text: "Already recorded" });
    return;
  }

  const rsvp = await upsertRsvp(
    eventId,
    BigInt(userId),
    status,
    displayNameFromCtx(ctx),
    option.id,
  );
  await refreshAnnouncementMessage(ctx.api, eventId);
  await sendPersonalCalendarInvite(
    ctx.api,
    userId,
    event,
    status,
    rsvp.icsSequence,
  );

  await ctx.answerCallbackQuery({
    text: `${option.emoji} ${option.label} — calendar file sent in private chat`,
  });
}
