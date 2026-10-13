import { InlineKeyboard } from "grammy";
import type { Api } from "grammy";
import { prisma, type Chat, type Event } from "@tg-cal/db";
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

export function formatAnnouncement(event: Event, timezone = "UTC"): string {
  const when = event.startsAt.toLocaleString("en-GB", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: event.allDay ? undefined : "short",
  });
  const lines = [
    `📢 *New event*`,
    `*${escapeMd(event.title)}*`,
    when,
  ];
  if (event.location) lines.push(`📍 ${escapeMd(event.location)}`);
  if (event.description) lines.push(`\n${escapeMd(event.description)}`);
  return lines.join("\n");
}

function escapeMd(text: string): string {
  return text.replace(/([_*`\[])/g, "\\$1");
}

export async function announceEvent(
  api: Api,
  chat: Chat,
  event: Event,
): Promise<void> {
  const counts = await rsvpCounts(event.id);
  try {
    const msg = await api.sendMessage(
      Number(chat.telegramChatId),
      formatAnnouncement(event, chat.timezone),
      {
        parse_mode: "Markdown",
        reply_markup: rsvpKeyboard(event.id, counts),
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
  try {
    await api.editMessageText(
      Number(event.chat.telegramChatId),
      event.announcementMessageId,
      formatAnnouncement(event, event.chat.timezone),
      {
        parse_mode: "Markdown",
        reply_markup: rsvpKeyboard(event.id, counts),
      },
    );
  } catch (err) {
    console.error("Failed to refresh announcement", err);
  }
}
