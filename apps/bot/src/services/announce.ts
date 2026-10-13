import { InlineKeyboard, InputFile } from "grammy";
import type { Api } from "grammy";
import { prisma, type Chat, type Event, type RsvpStatus } from "@tg-cal/db";
import {
  buildPersonalIcs,
  formatAnnouncement,
  type AnnouncementVoter,
  type PersonalIcsStatus,
} from "@tg-cal/shared";
import { rsvpCounts } from "./events.js";

export function rsvpKeyboard(eventId: string, counts?: {
  going: number;
  maybe: number;
  not_going: number;
}): InlineKeyboard {
  const c = counts ?? { going: 0, maybe: 0, not_going: 0 };
  return new InlineKeyboard()
    .text(`✅ Going (${c.going})`, `rsvp:${eventId}:going`)
    .text(`🤔 Maybe (${c.maybe})`, `rsvp:${eventId}:maybe`)
    .row()
    .text(`❌ No (${c.not_going})`, `rsvp:${eventId}:not_going`);
}

export { formatAnnouncement };

async function loadVoters(eventId: string): Promise<AnnouncementVoter[]> {
  const rows = await prisma.rsvp.findMany({ where: { eventId } });
  return rows.map((r) => ({
    status: r.status as AnnouncementVoter["status"],
    displayName: r.displayName || `User ${r.userId.toString()}`,
  }));
}

export async function announceEvent(
  api: Api,
  chat: Chat,
  event: Event,
): Promise<void> {
  const counts = await rsvpCounts(event.id);
  const voters = event.rsvpPublic ? await loadVoters(event.id) : undefined;
  try {
    const msg = await api.sendMessage(
      Number(chat.telegramChatId),
      formatAnnouncement(event, chat.timezone, { voters }),
      {
        parse_mode: "HTML",
        reply_markup: rsvpKeyboard(event.id, counts),
        link_preview_options: { is_disabled: true },
      },
    );
    await prisma.event.update({
      where: { id: event.id },
      data: { announcementMessageId: msg.message_id },
    });
  } catch (err) {
    console.error("Failed to announce event", err);
  }
}

export async function refreshAnnouncementMessage(
  api: Api,
  eventId: string,
): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { chat: true },
  });
  if (!event?.announcementMessageId) return;

  const counts = await rsvpCounts(event.id);
  const voters = event.rsvpPublic ? await loadVoters(event.id) : undefined;
  try {
    await api.editMessageText(
      Number(event.chat.telegramChatId),
      event.announcementMessageId,
      formatAnnouncement(event, event.chat.timezone, { voters }),
      {
        parse_mode: "HTML",
        reply_markup: rsvpKeyboard(event.id, counts),
        link_preview_options: { is_disabled: true },
      },
    );
  } catch (err) {
    console.error("Failed to refresh announcement", err);
  }
}

export async function sendPersonalCalendarInvite(
  api: Api,
  userId: number,
  event: Event,
  status: RsvpStatus | PersonalIcsStatus,
  sequence: number,
): Promise<void> {
  const ics = buildPersonalIcs({
    event,
    userId,
    status: status as PersonalIcsStatus,
    sequence,
  });
  const caption =
    status === "not_going"
      ? "Calendar update: open this file to remove/cancel the event on your phone."
      : status === "maybe"
        ? "Calendar update: open this file to save as tentative on your phone."
        : "Calendar update: open this file to add/update the event on your phone.";

  const filename = `${event.title.replace(/[^\w.-]+/g, "_").slice(0, 40) || "event"}.ics`;
  try {
    await api.sendDocument(
      userId,
      new InputFile(Buffer.from(ics, "utf8"), filename),
      { caption },
    );
  } catch (err) {
    console.error("Failed to send personal calendar file", err);
  }
}
