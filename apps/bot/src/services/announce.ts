import { InlineKeyboard, InputFile } from "grammy";
import type { Api } from "grammy";
import { prisma, type Chat, type Event, type RsvpStatus } from "@tg-cal/db";
import {
  TELEGRAM_CAPTION_MAX,
  buildPersonalIcs,
  buildRsvpKeyboardRows,
  countsByOptionId,
  formatAnnouncement,
  normalizeRsvpOptions,
  photoExtension,
  resolveVoteOptionId,
  type AnnouncementVoter,
  type PersonalIcsStatus,
} from "@tg-cal/shared";

export function rsvpKeyboard(
  event: Event,
  counts?: Record<string, number>,
): InlineKeyboard {
  const options = normalizeRsvpOptions(event.rsvpOptions);
  const c = counts ?? countsByOptionId(options, []);
  const rows = buildRsvpKeyboardRows(event.id, options, c);
  const kb = new InlineKeyboard();
  rows.forEach((row, rowIndex) => {
    if (rowIndex > 0) kb.row();
    for (const btn of row) {
      kb.text(btn.text, btn.callback_data);
    }
  });
  return kb;
}

export { formatAnnouncement };

async function loadVoters(
  eventId: string,
  event: Event,
): Promise<{ voters: AnnouncementVoter[]; counts: Record<string, number> }> {
  const options = normalizeRsvpOptions(event.rsvpOptions);
  const rows = await prisma.rsvp.findMany({ where: { eventId } });
  const counts = countsByOptionId(
    options,
    rows.map((r) => ({ optionId: r.optionId, status: r.status })),
  );
  const voters: AnnouncementVoter[] = [];
  for (const r of rows) {
    const optionId = resolveVoteOptionId(options, r.optionId, r.status);
    if (!optionId) continue;
    voters.push({
      optionId,
      displayName: r.displayName || `User ${r.userId.toString()}`,
    });
  }
  return { voters, counts };
}

export async function announceEvent(
  api: Api,
  chat: Chat,
  event: Event,
): Promise<void> {
  const { voters, counts } = await loadVoters(event.id, event);
  const chatId = Number(chat.telegramChatId);
  const hasPhoto = Boolean(event.photoData && event.photoMime);
  const keyboard = rsvpKeyboard(event, counts);

  try {
    let messageId: number | null = null;

    if (hasPhoto) {
      const caption = formatAnnouncement(event, chat.timezone, {
        voters: event.rsvpPublic ? voters : undefined,
        maxLength: TELEGRAM_CAPTION_MAX,
      });
      const photoMsg = await api.sendPhoto(
        chatId,
        new InputFile(
          Buffer.from(event.photoData!),
          `event.${photoExtension(event.photoMime!)}`,
        ),
        {
          caption,
          parse_mode: "HTML",
          reply_markup: keyboard,
        },
      );
      messageId = photoMsg.message_id;
    } else {
      const msg = await api.sendMessage(
        chatId,
        formatAnnouncement(event, chat.timezone, {
          voters: event.rsvpPublic ? voters : undefined,
        }),
        {
          parse_mode: "HTML",
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        },
      );
      messageId = msg.message_id;
    }

    await prisma.event.update({
      where: { id: event.id },
      data: {
        announcementMessageId: messageId,
        photoMessageId: hasPhoto ? messageId : null,
      },
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

  const { voters, counts } = await loadVoters(event.id, event);
  const hasPhoto = Boolean(event.photoMime);
  const keyboard = rsvpKeyboard(event, counts);
  const chatId = Number(event.chat.telegramChatId);

  try {
    if (hasPhoto) {
      await api.editMessageCaption(
        chatId,
        event.announcementMessageId,
        {
          caption: formatAnnouncement(event, event.chat.timezone, {
            voters: event.rsvpPublic ? voters : undefined,
            maxLength: TELEGRAM_CAPTION_MAX,
          }),
          parse_mode: "HTML",
          reply_markup: keyboard,
        },
      );
    } else {
      await api.editMessageText(
        chatId,
        event.announcementMessageId,
        formatAnnouncement(event, event.chat.timezone, {
          voters: event.rsvpPublic ? voters : undefined,
        }),
        {
          parse_mode: "HTML",
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        },
      );
    }
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
