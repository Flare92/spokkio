import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { ListConversationsInput, ConversationSummary, SendMessageInput, MessageOutput } from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppService } from "../whatsapp/whatsapp.service";

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
      },
      include: {
        contact: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });

    return conversations.map((c) => {
      const last = c.messages[0];
      return {
        id: c.id,
        contactId: c.contactId,
        contactName: [c.contact.firstName, c.contact.lastName].filter(Boolean).join(" ") || null,
        lastMessagePreview: last?.text ?? "",
        lastMessageAt: (last?.createdAt ?? c.createdAt).toISOString(),
        unread: last?.direction === "INBOUND" && last.status !== "READ",
        assignedOperatorId: c.assignedOperatorId,
      };
    });
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
      return this.toOutput(updated);
    } catch (err) {
      const updated = await this.prisma.message.update({
        where: { id: message.id },
        data: { status: "FAILED", failedReason: err instanceof Error ? err.message : "unknown error" },
      });
      return this.toOutput(updated);
    }
  }

  private toOutput(message: {
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
