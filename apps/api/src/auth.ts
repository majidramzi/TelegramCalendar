import type { FastifyRequest, FastifyReply } from "fastify";
import {
  InitDataError,
  validateInitData,
  verifyStartAppToken,
  type ValidatedInitData,
} from "@tg-cal/shared";
import { prisma, type Chat } from "@tg-cal/db";
import { config } from "./config.js";

declare module "fastify" {
  interface FastifyRequest {
    tg?: ValidatedInitData;
    chat?: Chat;
  }
}

export async function requireInitData(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = req.headers["x-telegram-init-data"];
  const initData =
    typeof header === "string"
      ? header
      : typeof req.headers.authorization === "string" &&
          req.headers.authorization.startsWith("tma ")
        ? req.headers.authorization.slice(4)
        : undefined;

  if (!initData) {
    reply.code(401).send({ error: "Missing Telegram initData" });
    return;
  }

  try {
    req.tg = validateInitData(
      initData,
      config.botToken(),
      config.initDataMaxAge(),
    );
  } catch (err) {
    const message =
      err instanceof InitDataError ? err.message : "Invalid initData";
    reply.code(401).send({ error: message });
  }
}

export async function resolveChatFromStartParam(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!req.tg) {
    reply.code(401).send({ error: "Unauthorized" });
    return;
  }

  const token =
    (req.query as { startapp?: string }).startapp ??
    req.tg.startParam ??
    (req.headers["x-startapp"] as string | undefined);

  if (!token) {
    reply.code(400).send({ error: "Missing startapp token" });
    return;
  }

  const payload = verifyStartAppToken(token, config.startAppSecret());
  if (!payload) {
    reply.code(403).send({ error: "Invalid or expired startapp token" });
    return;
  }

  const chat = await prisma.chat.findUnique({ where: { id: payload.chatId } });
  if (!chat) {
    reply.code(404).send({ error: "Chat not found" });
    return;
  }

  req.chat = chat;
}
