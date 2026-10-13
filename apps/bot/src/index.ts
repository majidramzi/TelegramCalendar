import { config } from "./config.js";
import { createBot } from "./bot.js";
import {
  restorePendingReminders,
  startReminderWorker,
} from "./queue/reminders.js";

async function main() {
  const bot = createBot();
  const worker = startReminderWorker();
  await restorePendingReminders();

  const mode = config.botMode();
  if (mode === "webhook") {
    console.log(
      "BOT_MODE=webhook — start apps/api (or the Fly server) to receive updates.",
    );
    console.log("Reminder worker is running in this process.");
    // Keep process alive for the worker when bot runs alone in webhook mode.
    await new Promise(() => {
      /* never resolves */
    });
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
