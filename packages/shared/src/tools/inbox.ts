import { z } from "zod";
import { MessageDeliveryStatusValues } from "../enums";

export const ListConversationsInput = z.object({
  teamId: z.string().uuid(),
  status: z.enum(["OPEN", "CLOSED", "ALL"]).default("OPEN"),
  // Cerca nel nome/telefono del contatto e nel testo degli ultimi messaggi.
  search: z.string().optional(),
  label: z.string().optional(),
  assignedOperatorId: z.string().uuid().optional(),
  onlyUnassigned: z.boolean().default(false),
});
export type ListConversationsInput = z.infer<typeof ListConversationsInput>;

export const ConversationSummary = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  contactName: z.string().nullable(),
  contactPhone: z.string(),
  lastMessagePreview: z.string(),
  lastMessageAt: z.string().datetime(),
  unread: z.boolean(),
  assignedOperatorId: z.string().uuid().nullable(),
  assignedOperatorEmail: z.string().nullable(),
  labels: z.array(z.string()),
});
export type ConversationSummary = z.infer<typeof ConversationSummary>;

export const MessageOutput = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  text: z.string(),
  status: z.enum(MessageDeliveryStatusValues),
  createdAt: z.string().datetime(),
});
export type MessageOutput = z.infer<typeof MessageOutput>;

export const GetConversationInput = z.object({
  teamId: z.string().uuid(),
  conversationId: z.string().uuid(),
});
export type GetConversationInput = z.infer<typeof GetConversationInput>;

export const ConversationDetailOutput = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  contactName: z.string().nullable(),
  contactPhone: z.string(),
  assignedOperatorId: z.string().uuid().nullable(),
  labels: z.array(z.string()),
  messages: z.array(MessageOutput),
});
export type ConversationDetailOutput = z.infer<typeof ConversationDetailOutput>;

export const SendMessageInput = z.object({
  teamId: z.string().uuid(),
  conversationId: z.string().uuid(),
  operatorId: z.string().uuid(),
  text: z.string().min(1),
});
export type SendMessageInput = z.infer<typeof SendMessageInput>;

export const AssignConversationInput = z.object({
  teamId: z.string().uuid(),
  conversationId: z.string().uuid(),
  // null = rimuove l'assegnazione (torna "non assegnata").
  operatorId: z.string().uuid().nullable(),
});
export type AssignConversationInput = z.infer<typeof AssignConversationInput>;

export const SetConversationLabelsInput = z.object({
  teamId: z.string().uuid(),
  conversationId: z.string().uuid(),
  labels: z.array(z.string()),
});
export type SetConversationLabelsInput = z.infer<typeof SetConversationLabelsInput>;

export const OperatorOutput = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: z.string(),
});
export type OperatorOutput = z.infer<typeof OperatorOutput>;

export const ListOperatorsInput = z.object({ teamId: z.string().uuid() });
export type ListOperatorsInput = z.infer<typeof ListOperatorsInput>;

// --- Canned responses (risposte rapide) -------------------------------

export const CannedResponseOutput = z.object({
  id: z.string().uuid(),
  shortcut: z.string(),
  text: z.string(),
});
export type CannedResponseOutput = z.infer<typeof CannedResponseOutput>;

export const ListCannedResponsesInput = z.object({ teamId: z.string().uuid() });
export type ListCannedResponsesInput = z.infer<typeof ListCannedResponsesInput>;

export const CreateCannedResponseInput = z.object({
  teamId: z.string().uuid(),
  shortcut: z.string().min(1).max(40),
  text: z.string().min(1),
});
export type CreateCannedResponseInput = z.infer<typeof CreateCannedResponseInput>;

export const DeleteCannedResponseInput = z.object({
  teamId: z.string().uuid(),
  cannedResponseId: z.string().uuid(),
});
export type DeleteCannedResponseInput = z.infer<typeof DeleteCannedResponseInput>;

export const INBOX_TOOLS = {
  "inbox.listConversations": { input: ListConversationsInput, output: z.array(ConversationSummary) },
  "inbox.getConversation": { input: GetConversationInput, output: ConversationDetailOutput },
  "inbox.sendMessage": { input: SendMessageInput, output: MessageOutput },
  "inbox.assign": { input: AssignConversationInput, output: ConversationSummary },
  "inbox.setLabels": { input: SetConversationLabelsInput, output: ConversationSummary },
  "inbox.listOperators": { input: ListOperatorsInput, output: z.array(OperatorOutput) },
  "inbox.listCannedResponses": { input: ListCannedResponsesInput, output: z.array(CannedResponseOutput) },
  "inbox.createCannedResponse": { input: CreateCannedResponseInput, output: CannedResponseOutput },
  "inbox.deleteCannedResponse": {
    input: DeleteCannedResponseInput,
    output: z.object({ deleted: z.literal(true) }),
  },
} as const;
