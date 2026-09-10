import { WebhookIngestService } from "./webhook-ingest.service";
import type { WebhookEvent } from "./whatsapp.service";

function createPrismaMock() {
  return {
    message: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    conversation: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    contact: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    attributionEvent: {
      create: jest.fn(),
    },
    template: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
}

type PrismaMock = ReturnType<typeof createPrismaMock>;

describe("WebhookIngestService", () => {
  let prisma: PrismaMock;
  let service: WebhookIngestService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new WebhookIngestService(prisma as any);
  });

  describe("status events", () => {
    const statusEvent: Extract<WebhookEvent, { type: "status" }> = {
      type: "status",
      waMessageId: "wamid.123",
      status: "delivered",
    };

    it("updates the message status and records one attribution event", async () => {
      prisma.message.findFirst.mockResolvedValue({
        id: "msg-1",
        conversationId: "conv-1",
        status: "SENT",
        deliveredAt: null,
        readAt: null,
        failedReason: null,
      });
      prisma.conversation.findUnique.mockResolvedValue({ id: "conv-1", contactId: "contact-1" });

      await service.handleEvents([statusEvent]);

      expect(prisma.message.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "msg-1" },
          data: expect.objectContaining({ status: "DELIVERED" }),
        }),
      );
      expect(prisma.attributionEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.attributionEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ contactId: "contact-1", messageId: "msg-1", kind: "delivered" }),
        }),
      );
    });

    it("is idempotent: a duplicate status notification is a no-op", async () => {
      // Meta's webhook delivery is at-least-once — the same "delivered" event
      // can be redelivered for the same message. The message already carries
      // this status, so nothing should be updated or recorded twice.
      prisma.message.findFirst.mockResolvedValue({
        id: "msg-1",
        conversationId: "conv-1",
        status: "DELIVERED",
        deliveredAt: new Date(),
        readAt: null,
        failedReason: null,
      });

      await service.handleEvents([statusEvent, statusEvent]);

      expect(prisma.message.update).not.toHaveBeenCalled();
      expect(prisma.attributionEvent.create).not.toHaveBeenCalled();
    });

    it("does nothing when the waMessageId is unknown", async () => {
      prisma.message.findFirst.mockResolvedValue(null);

      await service.handleEvents([statusEvent]);

      expect(prisma.message.update).not.toHaveBeenCalled();
      expect(prisma.attributionEvent.create).not.toHaveBeenCalled();
    });

    it("records the failure reason on a failed status", async () => {
      prisma.message.findFirst.mockResolvedValue({
        id: "msg-2",
        conversationId: "conv-2",
        status: "SENT",
        deliveredAt: null,
        readAt: null,
        failedReason: null,
      });
      prisma.conversation.findUnique.mockResolvedValue({ id: "conv-2", contactId: "contact-2" });

      await service.handleEvents([
        { type: "status", waMessageId: "wamid.456", status: "failed", failedReason: "Recipient opted out" },
      ]);

      expect(prisma.message.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "FAILED", failedReason: "Recipient opted out" }),
        }),
      );
    });
  });

  describe("inbound messages", () => {
    it("creates a message, reuses the open conversation, and refreshes lastActivityAt", async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: "contact-1", teamId: "team-1", phoneE164: "+391234567" });
      prisma.conversation.findFirst.mockResolvedValue({ id: "conv-1" });

      await service.handleEvents([
        { type: "inbound_message", fromE164: "+391234567", text: "Ciao!", waMessageId: "wamid.789" },
      ]);

      expect(prisma.conversation.create).not.toHaveBeenCalled();
      expect(prisma.contact.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "contact-1" }, data: { lastActivityAt: expect.any(Date) } }),
      );
      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: "conv-1",
            direction: "INBOUND",
            text: "Ciao!",
            waMessageId: "wamid.789",
          }),
        }),
      );
    });

    it("opens a new conversation when none is open", async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: "contact-1", teamId: "team-1", phoneE164: "+391234567" });
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({ id: "conv-new" });

      await service.handleEvents([
        { type: "inbound_message", fromE164: "+391234567", text: "Ciao!", waMessageId: "wamid.790" },
      ]);

      expect(prisma.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { teamId: "team-1", contactId: "contact-1" } }),
      );
    });

    it("ignores a message from a phone number with no matching contact", async () => {
      prisma.contact.findFirst.mockResolvedValue(null);

      await service.handleEvents([
        { type: "inbound_message", fromE164: "+39000000000", text: "Ciao!", waMessageId: "wamid.791" },
      ]);

      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(prisma.contact.update).not.toHaveBeenCalled();
    });
  });

  describe("template status events", () => {
    it("marks a template APPROVED and clears any rejection reason", async () => {
      prisma.template.findFirst.mockResolvedValue({ id: "tpl-1", status: "PENDING_REVIEW" });

      await service.handleEvents([
        { type: "template_status", templateName: "promo_estate", status: "APPROVED" },
      ]);

      expect(prisma.template.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "tpl-1" }, data: { status: "APPROVED", rejectionReason: null } }),
      );
    });
  });

  it("keeps processing remaining events when one event handler throws", async () => {
    prisma.message.findFirst.mockRejectedValueOnce(new Error("boom"));
    prisma.contact.findFirst.mockResolvedValue({ id: "contact-1", teamId: "team-1", phoneE164: "+391234567" });
    prisma.conversation.findFirst.mockResolvedValue({ id: "conv-1" });

    await service.handleEvents([
      { type: "status", waMessageId: "wamid.err", status: "sent" },
      { type: "inbound_message", fromE164: "+391234567", text: "Ciao!", waMessageId: "wamid.792" },
    ]);

    expect(prisma.message.create).toHaveBeenCalled();
  });
});
