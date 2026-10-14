import { Bot, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { config } from "./config.js";
import type { BotContext, SessionData } from "./context.js";
import { addEventConversation } from "./conversations/addevent.js";
import { handleMyChatMember } from "./handlers/membership.js";
import {
  handleCalendar,
  handleDeleteCallback,
  handleDeleteEvent,
  handleEvents,
  handlePermissions,
  handleStart,
} from "./handlers/commands.js";
import { handleRsvpCallback } from "./handlers/rsvp.js";

export { unpinLegacyCalendarMessages } from "./services/chat.js";

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(config.botToken());

  bot.use(
    session({
      initial: (): SessionData => ({}),
    }),
  );
  bot.use(conversations());
  bot.use(createConversation(addEventConversation, "addevent"));

  bot.command("start", handleStart);
  bot.command("events", handleEvents);
  bot.command("deleteevent", handleDeleteEvent);
  bot.command("permissions", handlePermissions);
  bot.command("calendar", handleCalendar);
  bot.command("addevent", async (ctx) => {
    await ctx.conversation.enter("addevent");
  });
  bot.command("cancel", async (ctx) => {
    await ctx.reply(
      "Nothing to cancel. If you are mid-flow, send /cancel again as the answer.",
    );
  });

  bot.on("my_chat_member", handleMyChatMember);
  bot.callbackQuery(/^rsvp:/, handleRsvpCallback);
  bot.callbackQuery(/^del:/, handleDeleteCallback);

  bot.catch((err) => {
    console.error("Bot error", err.error);
  });

  return bot;
}
