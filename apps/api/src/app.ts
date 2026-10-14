import Fastify from "fastify";
import cors from "@fastify/cors";
import { eventsRoutes } from "./routes/events.js";
import { icsRoutes } from "./routes/ics.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
    // Allow DELETE/GET with Content-Type: application/json and an empty body.
    // Allow event photo base64 (~2 MB decoded → ~2.7 MB JSON).
    bodyLimit: 4_194_304,
  });

  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      const raw = typeof body === "string" ? body : "";
      if (!raw) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(raw));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

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
