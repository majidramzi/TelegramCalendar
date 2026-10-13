import Fastify from "fastify";
import cors from "@fastify/cors";
import { eventsRoutes } from "./routes/events.js";
import { icsRoutes } from "./routes/ics.js";

export async function buildApp() {
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

  return app;
}
