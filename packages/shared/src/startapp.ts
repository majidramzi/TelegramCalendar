import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { StartAppPayload } from "./types.js";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Telegram Direct Link startapp may only contain A-Z a-z 0-9 _ -
 * so we use hex body + "_" + hex signature (no dots).
 * https://core.telegram.org/bots/webapps#direct-link-mini-apps
 */
export function createStartAppToken(
  chatId: string,
  secret: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  const payload: StartAppPayload = {
    chatId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("hex");
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return `${body}_${sig}`;
}

export function verifyStartAppToken(
  token: string,
  secret: string,
): StartAppPayload | null {
  if (!/^[0-9a-f]+_[0-9a-f]+$/i.test(token)) return null;
  const idx = token.lastIndexOf("_");
  if (idx <= 0) return null;
  const body = token.slice(0, idx);
  const sigHex = token.slice(idx + 1);
  if (!body || !sigHex) return null;

  const expected = createHmac("sha256", secret).update(body).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sigHex, "hex");
  } catch {
    return null;
  }
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, "hex").toString("utf8"),
    ) as StartAppPayload;
    if (!payload.chatId || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildDirectLink(
  botUsername: string,
  appShortName: string,
  startAppToken: string,
): string {
  const user = botUsername.replace(/^@/, "");
  // startapp must stay unescaped to [A-Za-z0-9_-] only; hex token is already safe
  return `https://t.me/${user}/${appShortName}?startapp=${startAppToken}`;
}

export function generateIcsSecret(): string {
  return randomBytes(24).toString("base64url");
}
