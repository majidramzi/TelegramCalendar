import type { Context, SessionFlavor } from "grammy";
import type {
  Conversation,
  ConversationFlavor,
} from "@grammyjs/conversations";

export interface SessionData {
  // reserved for future session fields
}

export type BotContext = Context &
  SessionFlavor<SessionData> &
  ConversationFlavor<Context>;

export type BotConversation = Conversation<BotContext, BotContext>;
