import { webhookCallback } from "grammy";
import { buildApp } from "@tg-cal/api";
import { createBot } from "@tg-cal/bot";
import {
  restorePendingReminders,
  startReminderWorker,
} from "@tg-cal/bot/queue";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

async function main() {
  const host = process.env.API_HOST ?? "0.0.0.0";
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);
  const webhookPath = process.env.WEBHOOK_PATH ?? "/telegram/webhook";
  const webhookSecret = process.env.WEBHOOK_SECRET ?? "";
  const publicApiUrl = required("PUBLIC_API_URL").replace(/\/$/, "");
  const webhookUrl = process.env.WEBHOOK_URL || `${publicApiUrl}${webhookPath}`;

  const bot = createBot();
  const app = await buildApp();
  const worker = startReminderWorker();
  await restorePendingReminders();

  const handleUpdate = webhookCallback(bot, "fastify", {
    secretToken: webhookSecret || undefined,
  });

  app.post(webhookPath, async (req, reply) => {
    await handleUpdate(req, reply);
  });

  await app.listen({ host, port });
  console.log(`Server listening on http://${host}:${port}`);

  await bot.api.setWebhook(webhookUrl, {
    secret_token: webhookSecret || undefined,
    drop_pending_updates: false,
  });
  console.log(`Telegram webhook set: ${webhookUrl}`);

  const shutdown = async () => {
    console.log("Shutting down…");
    try {
      await bot.api.deleteWebhook();
    } catch {
      // ignore
    }
    await app.close();
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
