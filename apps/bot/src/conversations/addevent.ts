import type { BotConversation, BotContext } from "../context.js";
import {
  canManageEvents,
  getChatByTelegramId,
} from "../services/chat.js";
import { createEvent } from "../services/events.js";
import { announceEvent } from "../services/announce.js";
import { scheduleRemindersForEvent } from "../queue/reminders.js";

function parseDate(input: string): Date | null {
  const trimmed = input.trim();
  // YYYY-MM-DD
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // DD/MM/YYYY or DD.MM.YYYY
  const m2 = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(trimmed);
  if (m2) {
    const d = new Date(
      Date.UTC(Number(m2[3]), Number(m2[2]) - 1, Number(m2[1])),
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function parseTime(input: string): { h: number; m: number } | "allday" | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "allday" || trimmed === "all day" || trimmed === "-") {
    return "allday";
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

export async function addEventConversation(
  conversation: BotConversation,
  ctx: BotContext,
) {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId) {
    await ctx.reply("This command only works in a group or channel.");
    return;
  }
  if (ctx.chat?.type === "private") {
    await ctx.reply("Add me to a group/channel and run /addevent there.");
    return;
  }

  const chat = await conversation.external(() =>
    getChatByTelegramId(chatId),
  );
  if (!chat) {
    await ctx.reply("This chat is not registered yet. Remove and re-add the bot.");
    return;
  }

  const allowed = await conversation.external(() =>
    canManageEvents(ctx.api, chat, userId),
  );
  if (!allowed) {
    await ctx.reply("Only admins can create events in this chat.");
    return;
  }

  await ctx.reply("Event title? (or /cancel)");
  const titleCtx = await conversation.wait();
  if (titleCtx.message?.text === "/cancel") {
    await ctx.reply("Cancelled.");
    return;
  }
  const title = titleCtx.message?.text?.trim();
  if (!title) {
    await ctx.reply("Title required. Cancelled.");
    return;
  }

  await ctx.reply("Date? (YYYY-MM-DD or DD/MM/YYYY)");
  const dateCtx = await conversation.wait();
  if (dateCtx.message?.text === "/cancel") {
    await ctx.reply("Cancelled.");
    return;
  }
  const date = parseDate(dateCtx.message?.text ?? "");
  if (!date) {
    await ctx.reply("Invalid date. Cancelled.");
    return;
  }

  await ctx.reply("Time? (HH:MM in 24h, or `allday`)", {
    parse_mode: "Markdown",
  });
  const timeCtx = await conversation.wait();
  if (timeCtx.message?.text === "/cancel") {
    await ctx.reply("Cancelled.");
    return;
  }
  const time = parseTime(timeCtx.message?.text ?? "");
  if (!time) {
    await ctx.reply("Invalid time. Cancelled.");
    return;
  }

  let startsAt: Date;
  let allDay = false;
  if (time === "allday") {
    allDay = true;
    startsAt = date;
  } else {
    startsAt = new Date(date);
    startsAt.setUTCHours(time.h, time.m, 0, 0);
  }

  await ctx.reply("Description? (send `-` to skip)");
  const descCtx = await conversation.wait();
  if (descCtx.message?.text === "/cancel") {
    await ctx.reply("Cancelled.");
    return;
  }
  const descRaw = descCtx.message?.text?.trim() ?? "-";
  const description = descRaw === "-" ? null : descRaw;

  const event = await conversation.external(() =>
    createEvent({
      chatId: chat.id,
      title,
      description,
      startsAt,
      allDay,
      createdBy: BigInt(userId),
    }),
  );

  await conversation.external(async () => {
    await scheduleRemindersForEvent(event);
    await announceEvent(ctx.api, chat, event);
  });

  await ctx.reply(`✅ Event created: *${title}*`, { parse_mode: "Markdown" });
}
