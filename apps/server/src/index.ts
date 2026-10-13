import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
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

function resolveMiniappDist(): string | null {
  const candidates = [
    process.env.MINIAPP_DIST,
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../miniapp/dist",
    ),
    path.resolve(process.cwd(), "../miniapp/dist"),
    path.resolve(process.cwd(), "apps/miniapp/dist"),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
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
  let worker: ReturnType<typeof startReminderWorker> | null = null;
  try {
    worker = startReminderWorker();
    await restorePendingReminders();
  } catch (err) {
    console.error("Reminder worker failed to start; continuing without it", err);
  }

  const handleUpdate = webhookCallback(bot, "fastify", {
    secretToken: webhookSecret || undefined,
  });

  app.post(webhookPath, async (req, reply) => {
    await handleUpdate(req, reply);
  });

  const miniappDist = resolveMiniappDist();
  // Help Telegram WebView embed the Mini App
  app.addHook("onSend", async (_req, reply) => {
    reply.header("Content-Security-Policy", "frame-ancestors https://web.telegram.org https://telegram.org 'self'");
    reply.removeHeader("X-Frame-Options");
  });

  if (miniappDist) {
    await app.register(fastifyStatic, {
      root: miniappDist,
      prefix: "/",
      wildcard: false,
    });

    // SPA fallback for client-side routes
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/ics") && !req.url.startsWith("/telegram") && !req.url.startsWith("/health")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
    console.log(`Serving Mini App from ${miniappDist}`);
  } else {
    console.warn("Mini App dist not found; API-only mode");
  }

  await app.listen({ host, port });
  console.log(`Server listening on http://${host}:${port}`);

  await bot.api.setWebhook(webhookUrl, {
    secret_token: webhookSecret || undefined,
    drop_pending_updates: false,
    allowed_updates: [
      "message",
      "callback_query",
      "my_chat_member",
      "chat_member",
      "edited_message",
    ],
  });
  console.log(`Telegram webhook set: ${webhookUrl}`);

  const shutdown = async () => {
    console.log("Shutting down…");
    // Keep Telegram webhook registered so updates resume when the machine wakes.
    await app.close();
    await worker?.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
