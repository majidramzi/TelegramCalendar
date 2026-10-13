import { RsvpStatus } from "@tg-cal/db";
import type { BotContext } from "../context.js";
import { upsertRsvp } from "../services/events.js";
import { refreshAnnouncementMessage } from "../services/announce.js";

const STATUS_MAP: Record<string, RsvpStatus> = {
  going: RsvpStatus.going,
  maybe: RsvpStatus.maybe,
  not_going: RsvpStatus.not_going,
};

export async function handleRsvpCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const userId = ctx.from?.id;
  if (!data?.startsWith("rsvp:") || !userId) return;

  const parts = data.split(":");
  // rsvp:<eventId>:<status>
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

  await upsertRsvp(eventId, BigInt(userId), status);
  await refreshAnnouncementMessage(ctx.api, eventId);

  const labels = {
    going: "Going",
    maybe: "Maybe",
    not_going: "Not going",
  } as const;

  await ctx.answerCallbackQuery({ text: `RSVP: ${labels[status]}` });
}
