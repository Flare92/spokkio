import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ListConversationsInput,
  ConversationSummary,
  GetConversationInput,
  ConversationDetailOutput,
  SendMessageInput,
  MessageOutput,
  AssignConversationInput,
  SetConversationLabelsInput,
  OperatorOutput,
  ListOperatorsInput,
  CannedResponseOutput,
  ListCannedResponsesInput,
  CreateCannedResponseInput,
  DeleteCannedResponseInput,
} from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppService } from "../whatsapp/whatsapp.service";

const CONVERSATION_INCLUDE = {
  contact: true,
  assignedOperator: true,
  messages: { orderBy: { createdAt: "desc" as const }, take: 1 },
};

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  // Tool: inbox.listConversations — team-wide shared inbox, unlimited operators.
  async listConversations(input: ListConversationsInput): Promise<ConversationSummary[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        teamId: input.teamId,
        closedAt: input.status === "OPEN" ? null : input.status === "CLOSED" ? { not: null } : undefined,
        assignedOperatorId: input.onlyUnassigned ? null : input.assignedOperatorId,
        labels: input.label ? { has: input.label } : undefined,
        ...(input.search
          ? {
              OR: [
                { contact: { firstName: { contains: input.search, mode: "insensitive" as const } } },
                { contact: { lastName: { contains: input.search, mode: "insensitive" as const } } },
                { contact: { phoneE164: { contains: input.search, mode: "insensitive" as const } } },
                { messages: { some: { text: { contains: input.search, mode: "insensitive" as const } } } },
              ],
            }
          : {}),
      },
      include: CONVERSATION_INCLUDE,
      orderBy: { createdAt: "desc" },
    });

    return conversations.map((c) => this.toSummary(c));
  }

  // Tool: inbox.getConversation — full message history for the thread view.
  async getConversation(input: GetConversationInput): Promise<ConversationDetailOutput> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: input.conversationId, teamId: input.teamId },
      include: { contact: true, messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");

    return {
      id: conversation.id,
      contactId: conversation.contactId,
      contactName: [conversation.contact.firstName, conversation.contact.lastName].filter(Boolean).join(" ") || null,
      contactPhone: conversation.contact.phoneE164,
      assignedOperatorId: conversation.assignedOperatorId,
      labels: conversation.labels,
      messages: conversation.messages.map((m) => this.toMessageOutput(m)),
    };
  }

  // Tool: inbox.sendMessage — manual operator reply. Sent as a free-form
  // WhatsApp session message (only valid inside Meta's 24h customer-service
  // window); outside that window a template send is required instead.
  async sendMessage(input: SendMessageInput): Promise<MessageOutput> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: input.conversationId, teamId: input.teamId },
      include: { contact: true },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");

    const operator = await this.prisma.user.findFirst({
      where: { id: input.operatorId, teamId: input.teamId },
    });
    if (!operator) throw new BadRequestException("operatorId does not belong to this team");

    const waConnection = await this.prisma.whatsAppConnection.findUnique({
      where: { teamId: input.teamId },
    });
    if (!waConnection) throw new BadRequestException("No WhatsApp connection configured for this team");

    if (!conversation.assignedOperatorId) {
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { assignedOperatorId: input.operatorId },
      });
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        category: "SERVICE",
        text: input.text,
        status: "QUEUED",
      },
    });

    try {
      const result = await this.whatsapp.sendTextMessage({
        phoneNumberId: waConnection.phoneNumberId,
        accessToken: waConnection.accessTokenEncrypted,
        toE164: conversation.contact.phoneE164,
        text: input.text,
      });
      const updated = await this.prisma.message.update({
        where: { id: message.id },
        data: { waMessageId: result.waMessageId, status: "SENT" },
      });
      return this.toMessageOutput(updated);
    } catch (err) {
      const updated = await this.prisma.message.update({
        where: { id: message.id },
        data: { status: "FAILED", failedReason: err instanceof Error ? err.message : "unknown error" },
      });
      return this.toMessageOutput(updated);
    }
  }

  // Tool: inbox.assign — hand a conversation to a specific operator, or pass
  // operatorId: null to put it back in the unassigned pool.
  async assignConversation(input: AssignConversationInput): Promise<ConversationSummary> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: input.conversationId, teamId: input.teamId },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");

    if (input.operatorId) {
      const operator = await this.prisma.user.findFirst({
        where: { id: input.operatorId, teamId: input.teamId },
      });
      if (!operator) throw new BadRequestException("operatorId does not belong to this team");
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { assignedOperatorId: input.operatorId },
      include: CONVERSATION_INCLUDE,
    });
    return this.toSummary(updated);
  }

  // Tool: inbox.setLabels — replaces the full label set for a conversation.
  async setLabels(input: SetConversationLabelsInput): Promise<ConversationSummary> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: input.conversationId, teamId: input.teamId },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");

    const updated = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { labels: input.labels },
      include: CONVERSATION_INCLUDE,
    });
    return this.toSummary(updated);
  }

  // Tool: inbox.listOperators — populates the assignment dropdown.
  async listOperators(input: ListOperatorsInput): Promise<OperatorOutput[]> {
    const users = await this.prisma.user.findMany({
      where: { teamId: input.teamId },
      orderBy: { email: "asc" },
    });
    return users.map((u) => ({ id: u.id, email: u.email, role: u.role }));
  }

  // Tool: inbox.listCannedResponses
  async listCannedResponses(input: ListCannedResponsesInput): Promise<CannedResponseOutput[]> {
    const responses = await this.prisma.cannedResponse.findMany({
      where: { teamId: input.teamId },
      orderBy: { shortcut: "asc" },
    });
    return responses.map((r) => ({ id: r.id, shortcut: r.shortcut, text: r.text }));
  }

  // Tool: inbox.createCannedResponse
  async createCannedResponse(input: CreateCannedResponseInput): Promise<CannedResponseOutput> {
    const existing = await this.prisma.cannedResponse.findUnique({
      where: { teamId_shortcut: { teamId: input.teamId, shortcut: input.shortcut } },
    });
    if (existing) throw new BadRequestException("Esiste già una risposta rapida con questo shortcut");

    const response = await this.prisma.cannedResponse.create({
      data: { teamId: input.teamId, shortcut: input.shortcut, text: input.text },
    });
    return { id: response.id, shortcut: response.shortcut, text: response.text };
  }

  // Tool: inbox.deleteCannedResponse
  async deleteCannedResponse(input: DeleteCannedResponseInput): Promise<{ deleted: true }> {
    const existing = await this.prisma.cannedResponse.findFirst({
      where: { id: input.cannedResponseId, teamId: input.teamId },
    });
    if (!existing) throw new NotFoundException("Canned response not found");

    await this.prisma.cannedResponse.delete({ where: { id: existing.id } });
    return { deleted: true };
  }

  private toSummary(c: {
    id: string;
    contactId: string;
    assignedOperatorId: string | null;
    labels: string[];
    createdAt: Date;
    contact: { firstName: string | null; lastName: string | null; phoneE164: string };
    assignedOperator: { email: string } | null;
    messages: { text: string; direction: string; status: string; createdAt: Date }[];
  }): ConversationSummary {
    const last = c.messages[0];
    return {
      id: c.id,
      contactId: c.contactId,
      contactName: [c.contact.firstName, c.contact.lastName].filter(Boolean).join(" ") || null,
      contactPhone: c.contact.phoneE164,
      lastMessagePreview: last?.text ?? "",
      lastMessageAt: (last?.createdAt ?? c.createdAt).toISOString(),
      unread: last?.direction === "INBOUND" && last.status !== "READ",
      assignedOperatorId: c.assignedOperatorId,
      assignedOperatorEmail: c.assignedOperator?.email ?? null,
      labels: c.labels,
    };
  }

  private toMessageOutput(message: {
    id: string;
    conversationId: string;
    direction: string;
    text: string;
    status: string;
    createdAt: Date;
  }): MessageOutput {
    return {
      id: message.id,
      conversationId: message.conversationId,
      direction: message.direction as "INBOUND" | "OUTBOUND",
      text: message.text,
      status: message.status as any,
      createdAt: message.createdAt.toISOString(),
    };
  }
}
