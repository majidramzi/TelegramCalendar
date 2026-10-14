import type { BotContext } from "../context.js";
import {
  upsertChatFromTelegram,
  postCalendarMessage,
} from "../services/chat.js";

const GROUP_TYPES = new Set(["group", "supergroup", "channel"]);

export async function handleMyChatMember(ctx: BotContext): Promise<void> {
  const update = ctx.myChatMember;
  if (!update) return;

  const chat = update.chat;
  if (!GROUP_TYPES.has(chat.type)) return;

  const newStatus = update.new_chat_member.status;
  const oldStatus = update.old_chat_member.status;

  const joined =
    (newStatus === "member" ||
      newStatus === "administrator" ||
      newStatus === "restricted") &&
    (oldStatus === "left" || oldStatus === "kicked");

  const promotedToAdmin =
    newStatus === "administrator" && oldStatus !== "administrator";

  if (!joined && !promotedToAdmin) return;

  if (chat.type === "channel" && newStatus !== "administrator") {
    // Channels: bot must be admin to post
    const fromId = update.from.id;
    try {
      await ctx.api.sendMessage(
        fromId,
        `I was added to channel "${"title" in chat && chat.title ? chat.title : String(chat.id)}" but I need admin rights to post the calendar message. Please promote me to admin, then I'll set up the calendar.`,
      );
    } catch {
      // can't DM user
    }
    // still register the chat
    await upsertChatFromTelegram(chat);
    return;
  }

  const dbChat = await upsertChatFromTelegram(chat);
  const messageId = await postCalendarMessage(ctx.api, chat.id, dbChat);

  if (!messageId && chat.type === "channel") {
    const fromId = update.from.id;
    try {
      await ctx.api.sendMessage(
        fromId,
        `Registered channel "${dbChat.title}" but failed to post the calendar message. Ensure I can post messages.`,
      );
    } catch {
      // ignore
    }
  }
}
