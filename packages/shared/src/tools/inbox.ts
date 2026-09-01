import { z } from "zod";
import { MessageDeliveryStatusValues } from "../enums";

export const ListConversationsInput = z.object({
  teamId: z.string().uuid(),
  status: z.enum(["OPEN", "CLOSED", "ALL"]).default("OPEN"),
});
export type ListConversationsInput = z.infer<typeof ListConversationsInput>;

export const ConversationSummary = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  contactName: z.string().nullable(),
  lastMessagePreview: z.string(),
  lastMessageAt: z.string().datetime(),
  unread: z.boolean(),
  assignedOperatorId: z.string().uuid().nullable(),
});
export type ConversationSummary = z.infer<typeof ConversationSummary>;

export const SendMessageInput = z.object({
  teamId: z.string().uuid(),
  conversationId: z.string().uuid(),
  operatorId: z.string().uuid(),
  text: z.string().min(1),
});
export type SendMessageInput = z.infer<typeof SendMessageInput>;

export const MessageOutput = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  text: z.string(),
  status: z.enum(MessageDeliveryStatusValues),
  createdAt: z.string().datetime(),
});
export type MessageOutput = z.infer<typeof MessageOutput>;

export const INBOX_TOOLS = {
  "inbox.listConversations": { input: ListConversationsInput, output: z.array(ConversationSummary) },
  "inbox.sendMessage": { input: SendMessageInput, output: MessageOutput },
} as const;
