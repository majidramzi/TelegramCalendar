import {
  prisma,
  ChatType,
  PermissionMode,
  type Chat,
} from "@tg-cal/db";
import {
  buildDirectLink,
  createStartAppToken,
  generateIcsSecret,
} from "@tg-cal/shared";
import type { Api } from "grammy";
import type { Chat as TgChat } from "@grammyjs/types";
import { InlineKeyboard } from "grammy";
import { config } from "../config.js";

function mapChatType(type: string): ChatType {
  if (type === "channel") return ChatType.channel;
  if (type === "supergroup") return ChatType.supergroup;
  return ChatType.group;
}

export async function upsertChatFromTelegram(tgChat: TgChat): Promise<Chat> {
  const telegramChatId = BigInt(tgChat.id);
  const type = mapChatType(tgChat.type);
  const title =
    "title" in tgChat && typeof tgChat.title === "string"
      ? tgChat.title
      : `Chat ${tgChat.id}`;

  const existing = await prisma.chat.findUnique({
    where: { telegramChatId },
  });

  if (existing) {
    return prisma.chat.update({
      where: { id: existing.id },
      data: { title, type },
    });
  }

  return prisma.chat.create({
    data: {
      telegramChatId,
      type,
      title,
      icsSecret: generateIcsSecret(),
      permissionMode: PermissionMode.admins_only,
    },
  });
}

export function calendarKeyboard(chatDbId: string): InlineKeyboard {
  const token = createStartAppToken(chatDbId, config.startAppSecret());
  const url = buildDirectLink(
    config.botUsername(),
    config.miniAppShortName(),
    token,
  );
  return new InlineKeyboard().url("📅 Calendar", url);
}

export async function postAndPinCalendarMessage(
  api: Api,
  telegramChatId: number | bigint,
  chat: Chat,
): Promise<number | null> {
  const chatId = Number(telegramChatId);
  try {
    const msg = await api.sendMessage(
      chatId,
      `📅 *${chat.title}* calendar\n\nOpen the shared calendar, add events, and RSVP.`,
      {
        parse_mode: "Markdown",
        reply_markup: calendarKeyboard(chat.id),
      },
    );

    try {
      await api.pinChatMessage(chatId, msg.message_id, {
        disable_notification: true,
      });
    } catch {
      // pin may fail without rights; message still posted
    }

    await prisma.chat.update({
      where: { id: chat.id },
      data: { calendarMessageId: msg.message_id },
    });

    return msg.message_id;
  } catch (err) {
    console.error("Failed to post calendar message", err);
    return null;
  }
}

export async function isUserAdmin(
  api: Api,
  telegramChatId: number | bigint,
  userId: number,
): Promise<boolean> {
  try {
    const member = await api.getChatMember(Number(telegramChatId), userId);
    return (
      member.status === "creator" ||
      member.status === "administrator"
    );
  } catch {
    return false;
  }
}

export async function canManageEvents(
  api: Api,
  chat: Chat,
  userId: number,
): Promise<boolean> {
  if (chat.permissionMode === PermissionMode.all_members) return true;
  return isUserAdmin(api, chat.telegramChatId, userId);
}

export async function getChatByTelegramId(
  telegramChatId: number | bigint,
): Promise<Chat | null> {
  return prisma.chat.findUnique({
    where: { telegramChatId: BigInt(telegramChatId) },
  });
}
