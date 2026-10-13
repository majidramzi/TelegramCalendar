import { createHmac, timingSafeEqual } from "node:crypto";
import type { TelegramWebAppUser, ValidatedInitData } from "./types.js";

export class InitDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InitDataError";
  }
}

/**
 * Validate Telegram WebApp initData (HMAC-SHA256 with bot token).
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86_400,
): ValidatedInitData {
  if (!initData || !botToken) {
    throw new InitDataError("Missing initData or bot token");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new InitDataError("Missing hash");

  params.delete("hash");
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new InitDataError("Invalid initData signature");
  }

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw) throw new InitDataError("Missing auth_date");
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) throw new InitDataError("Invalid auth_date");

  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAgeSeconds) {
    throw new InitDataError("initData expired");
  }

  const userRaw = params.get("user");
  if (!userRaw) throw new InitDataError("Missing user");

  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(userRaw) as TelegramWebAppUser;
  } catch {
    throw new InitDataError("Invalid user JSON");
  }
  if (!user?.id) throw new InitDataError("Invalid user id");

  const raw: Record<string, string> = {};
  for (const [k, v] of params.entries()) raw[k] = v;

  return {
    user,
    authDate,
    queryId: params.get("query_id") ?? undefined,
    startParam: params.get("start_param") ?? undefined,
    chatInstance: params.get("chat_instance") ?? undefined,
    chatType: params.get("chat_type") ?? undefined,
    raw,
  };
}
