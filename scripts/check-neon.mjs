import { prisma } from "@tg-cal/db";

const n = await prisma.chat.count();
console.log("neon_ok chats=", n);
await prisma.$disconnect();
