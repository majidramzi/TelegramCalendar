import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { eventsRoutes } from "./routes/events.js";
import { icsRoutes } from "./routes/ics.js";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Telegram-Init-Data",
      "X-Startapp",
    ],
  });

  app.get("/health", async () => ({ ok: true }));

  await app.register(eventsRoutes, { prefix: "/api" });
  await app.register(icsRoutes);

  const host = config.host();
  const port = config.port();
  await app.listen({ host, port });
  console.log(`API listening on http://${host}:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
