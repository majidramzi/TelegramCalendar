import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { StartAppPayload } from "./types.js";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64url");
}

function b64urlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

export function createStartAppToken(
  chatId: string,
  secret: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  const payload: StartAppPayload = {
    chatId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest();
  return `${body}.${b64urlEncode(sig)}`;
}

export function verifyStartAppToken(
  token: string,
  secret: string,
): StartAppPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sigB64] = parts;
  if (!body || !sigB64) return null;

  const expected = createHmac("sha256", secret).update(body).digest();
  let provided: Buffer;
  try {
    provided = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8")) as StartAppPayload;
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
  return `https://t.me/${user}/${appShortName}?startapp=${encodeURIComponent(startAppToken)}`;
}

export function generateIcsSecret(): string {
  return randomBytes(24).toString("base64url");
}
