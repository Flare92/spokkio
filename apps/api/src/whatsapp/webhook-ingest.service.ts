import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { WebhookEvent } from "./whatsapp.service";

const STATUS_MAP: Record<string, "SENT" | "DELIVERED" | "READ" | "FAILED"> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

// Turns raw WhatsApp webhook events into: (1) message status + delivery
// timestamps, (2) one AttributionEvent row per status change so analytics
// can always drill down to the underlying event, (3) template
// approval/rejection state, (4) inbound messages landing in the shared inbox.
@Injectable()
export class WebhookIngestService {
  private readonly logger = new Logger(WebhookIngestService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleEvents(events: WebhookEvent[]) {
    for (const event of events) {
      try {
        if (event.type === "status") await this.handleStatus(event);
        else if (event.type === "inbound_message") await this.handleInboundMessage(event);
        else if (event.type === "template_status") await this.handleTemplateStatus(event);
      } catch (err) {
        this.logger.error(`Failed to process webhook event: ${JSON.stringify(event)}`, err as Error);
      }
    }
  }

  private async handleStatus(event: Extract<WebhookEvent, { type: "status" }>) {
    const message = await this.prisma.message.findFirst({ where: { waMessageId: event.waMessageId } });
    if (!message) return;

    const status = STATUS_MAP[event.status];
    if (!status) return;

    await this.prisma.message.update({
      where: { id: message.id },
      data: {
        status,
        deliveredAt: status === "DELIVERED" ? new Date() : message.deliveredAt,
        readAt: status === "READ" ? new Date() : message.readAt,
        failedReason: status === "FAILED" ? event.failedReason : message.failedReason,
      },
    });

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: message.conversationId },
    });
    if (!conversation) return;

    await this.prisma.attributionEvent.create({
      data: {
        contactId: conversation.contactId,
        messageId: message.id,
        kind: event.status,
        detail: event.failedReason ?? null,
      },
    });
  }

  private async handleInboundMessage(event: Extract<WebhookEvent, { type: "inbound_message" }>) {
    // Inbound messages are matched to a team via the contact's phone number.
    // In a multi-team deployment the phone_number_id in the webhook payload
    // should be used instead; kept simple here since Fase 1 is single-WABA.
    const contact = await this.prisma.contact.findFirst({ where: { phoneE164: event.fromE164 } });
    if (!contact) {
      this.logger.warn(`Inbound message from unknown contact ${event.fromE164}`);
      return;
    }

    let conversation = await this.prisma.conversation.findFirst({
      where: { contactId: contact.id, closedAt: null },
    });
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { teamId: contact.teamId, contactId: contact.id },
      });
    }

    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "INBOUND",
        text: event.text,
        waMessageId: event.waMessageId,
        status: "DELIVERED",
      },
    });
  }

  private async handleTemplateStatus(event: Extract<WebhookEvent, { type: "template_status" }>) {
    const template = await this.prisma.template.findFirst({ where: { name: event.templateName } });
    if (!template) return;

    await this.prisma.template.update({
      where: { id: template.id },
      data: {
        status: event.status === "APPROVED" ? "APPROVED" : event.status === "REJECTED" ? "REJECTED" : template.status,
        rejectionReason: event.rejectionReason ?? null,
      },
    });
  }
}
