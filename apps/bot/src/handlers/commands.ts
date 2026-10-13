import { InlineKeyboard } from "grammy";
import { PermissionMode } from "@tg-cal/db";
import { prisma } from "@tg-cal/db";
import type { BotContext } from "../context.js";
import {
  canManageEvents,
  getChatByTelegramId,
  isUserAdmin,
  calendarKeyboard,
  postAndPinCalendarMessage,
  upsertChatFromTelegram,
} from "../services/chat.js";
import {
  deleteEvent,
  formatEventLine,
  getEvent,
  listUpcomingEvents,
} from "../services/events.js";
import { cancelRemindersForEvent } from "../queue/reminders.js";

export async function handleStart(ctx: BotContext): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("Send /start to me in a private chat for help.");
    return;
  }
  await ctx.reply(
    [
      "📅 *Telegram Group Calendar*",
      "",
      "Add me to a group or channel (as admin for channels).",
      "I'll pin a Calendar button for everyone.",
      "",
      "*Commands (in the group):*",
      "/addevent — create an event",
      "/events — list upcoming events",
      "/deleteevent — delete an event",
      "/permissions — admins\\_only or all\\_members",
      "/calendar — repost the calendar link",
    ].join("\n"),
    { parse_mode: "Markdown" },
  );
}

export async function handleEvents(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId || ctx.chat?.type === "private") {
    await ctx.reply("Use /events inside a group or channel.");
    return;
  }

  const chat = await getChatByTelegramId(chatId);
  if (!chat) {
    await ctx.reply("Chat not registered. Re-add the bot.");
    return;
  }

  const events = await listUpcomingEvents(chat.id);
  if (!events.length) {
    await ctx.reply("No upcoming events. Use /addevent to create one.");
    return;
  }

  const lines = events.map((e) => formatEventLine(e, chat.timezone));
  await ctx.reply(`*Upcoming events*\n\n${lines.join("\n\n")}`, {
    parse_mode: "Markdown",
  });
}

export async function handleDeleteEvent(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId || ctx.chat?.type === "private") {
    await ctx.reply("Use /deleteevent inside a group or channel.");
    return;
  }

  const chat = await getChatByTelegramId(chatId);
  if (!chat) {
    await ctx.reply("Chat not registered.");
    return;
  }

  const arg = ctx.match?.toString().trim();
  if (!arg) {
    const events = await listUpcomingEvents(chat.id, 10);
    if (!events.length) {
      await ctx.reply("No events to delete.");
      return;
    }
    const kb = new InlineKeyboard();
    for (const e of events) {
      kb.text(`🗑 ${e.title.slice(0, 30)}`, `del:${e.id}`).row();
    }
    await ctx.reply("Pick an event to delete:", { reply_markup: kb });
    return;
  }

  await tryDeleteByPrefix(ctx, chat.id, arg, userId);
}

async function tryDeleteByPrefix(
  ctx: BotContext,
  chatDbId: string,
  prefix: string,
  userId: number,
): Promise<void> {
  const event = await prisma.event.findFirst({
    where: {
      chatId: chatDbId,
      id: { startsWith: prefix },
    },
  });
  if (!event) {
    await ctx.reply("Event not found.");
    return;
  }
  await performDelete(ctx, event.id, userId);
}

export async function handleDeleteCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const userId = ctx.from?.id;
  if (!data?.startsWith("del:") || !userId) return;
  const eventId = data.slice(4);
  await ctx.answerCallbackQuery();
  await performDelete(ctx, eventId, userId);
}

async function performDelete(
  ctx: BotContext,
  eventId: string,
  userId: number,
): Promise<void> {
  const event = await getEvent(eventId);
  if (!event) {
    await ctx.reply("Event not found.");
    return;
  }

  const isCreator = event.createdBy === BigInt(userId);
  const admin = await isUserAdmin(
    ctx.api,
    event.chat.telegramChatId,
    userId,
  );
  if (!isCreator && !admin) {
    await ctx.reply("Only the creator or an admin can delete this event.");
    return;
  }

  await cancelRemindersForEvent(eventId);
  await deleteEvent(eventId);
  await ctx.reply(`Deleted: ${event.title}`);
}

export async function handlePermissions(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId || ctx.chat?.type === "private") {
    await ctx.reply("Use /permissions inside a group or channel.");
    return;
  }

  const chat = await getChatByTelegramId(chatId);
  if (!chat) {
    await ctx.reply("Chat not registered.");
    return;
  }

  if (!(await isUserAdmin(ctx.api, chatId, userId))) {
    await ctx.reply("Only admins can change permissions.");
    return;
  }

  const arg = ctx.match?.toString().trim().toLowerCase();
  if (!arg) {
    await ctx.reply(
      `Current mode: *${chat.permissionMode}*\n\nUsage:\n/permissions admins\\_only\n/permissions all\\_members`,
      { parse_mode: "Markdown" },
    );
    return;
  }

  if (arg !== "admins_only" && arg !== "all_members") {
    await ctx.reply("Use `admins_only` or `all_members`.", {
      parse_mode: "Markdown",
    });
    return;
  }

  await prisma.chat.update({
    where: { id: chat.id },
    data: {
      permissionMode:
        arg === "all_members"
          ? PermissionMode.all_members
          : PermissionMode.admins_only,
    },
  });
  await ctx.reply(`Permissions set to *${arg}*`, { parse_mode: "Markdown" });
}

export async function handleCalendar(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId || ctx.chat?.type === "private") {
    await ctx.reply("Use /calendar inside a group or channel.");
    return;
  }

  let chat = await getChatByTelegramId(chatId);
  if (!chat && ctx.chat) {
    chat = await upsertChatFromTelegram(ctx.chat);
  }
  if (!chat) {
    await ctx.reply("Could not register this chat.");
    return;
  }

  if (!(await canManageEvents(ctx.api, chat, userId))) {
    await ctx.reply("Open calendar:", {
      reply_markup: calendarKeyboard(chat.id),
    });
    return;
  }

  await postAndPinCalendarMessage(ctx.api, chatId, chat);
  await ctx.reply("Calendar message posted.", {
    reply_markup: calendarKeyboard(chat.id),
  });
}
