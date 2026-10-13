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
import {
  restorePendingReminders,
  startReminderWorker,
} from "./queue/reminders.js";

async function main() {
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
    await ctx.reply("Nothing to cancel. If you are mid-flow, send /cancel again as the answer.");
  });

  bot.on("my_chat_member", handleMyChatMember);

  bot.callbackQuery(/^rsvp:/, handleRsvpCallback);
  bot.callbackQuery(/^del:/, handleDeleteCallback);

  bot.catch((err) => {
    console.error("Bot error", err.error);
  });

  const worker = startReminderWorker();
  await restorePendingReminders();

  const mode = config.botMode();
  if (mode === "webhook") {
    const url = config.webhookUrl();
    if (!url) throw new Error("WEBHOOK_URL required in webhook mode");
    await bot.api.setWebhook(url, {
      secret_token: config.webhookSecret() || undefined,
    });
    console.log("Webhook set:", url);
    // note: webhook HTTP server lives in apps/api in production setups;
    // for now we still allow polling fallback messaging
  } else {
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    console.log("Starting bot (long polling)…");
    await bot.start({
      onStart: (info) => console.log(`Bot @${info.username} running`),
    });
  }

  const shutdown = async () => {
    console.log("Shutting down…");
    await bot.stop();
    await worker.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
