import { prisma } from "@tg-cal/db";
import { config } from "./config.js";

interface ChatMemberResult {
  ok: boolean;
  result?: { status: string };
}

export async function isTelegramAdmin(
  telegramChatId: bigint,
  userId: number,
  chatDbId: string,
): Promise<boolean> {
  const cached = await prisma.chatAdminCache.findUnique({
    where: {
      chatId_userId: { chatId: chatDbId, userId: BigInt(userId) },
    },
  });
  if (cached) {
    const age = Date.now() - cached.checkedAt.getTime();
    if (age < 10 * 60_000) {
      return cached.role === "administrator" || cached.role === "creator";
    }
  }

  const url = `https://api.telegram.org/bot${config.botToken()}/getChatMember`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: Number(telegramChatId),
      user_id: userId,
    }),
  });
  const data = (await res.json()) as ChatMemberResult;
  const status = data.result?.status ?? "left";
  const isAdmin = status === "administrator" || status === "creator";

  await prisma.chatAdminCache.upsert({
    where: {
      chatId_userId: { chatId: chatDbId, userId: BigInt(userId) },
    },
    create: {
      chatId: chatDbId,
      userId: BigInt(userId),
      role: status,
    },
    update: { role: status, checkedAt: new Date() },
  });

  return isAdmin;
}
