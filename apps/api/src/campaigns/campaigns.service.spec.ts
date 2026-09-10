import { ForbiddenException, BadRequestException } from "@nestjs/common";
import { CampaignsService } from "./campaigns.service";
import { META_CONVERSATION_RATE_EUR_IT, PLATFORM_MARKUP_EUR } from "./pricing";

function createPrismaMock() {
  return {
    segment: { findFirst: jest.fn() },
    template: { findFirst: jest.fn() },
    campaign: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    whatsAppConnection: { findUnique: jest.fn() },
    conversation: { findFirst: jest.fn(), create: jest.fn() },
    message: { create: jest.fn(), update: jest.fn() },
    trackedLink: { create: jest.fn() },
    attributionEvent: { groupBy: jest.fn() },
  };
}

type PrismaMock = ReturnType<typeof createPrismaMock>;

function createWhatsAppMock() {
  return { sendTemplateMessage: jest.fn() };
}

function makeContact(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    phoneE164: `+3900000000${id}`,
    firstName: "Mario",
    lastName: "Rossi",
    email: null,
    customFields: {},
    ...overrides,
  };
}

describe("CampaignsService", () => {
  let prisma: PrismaMock;
  let whatsapp: ReturnType<typeof createWhatsAppMock>;
  let service: CampaignsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    whatsapp = createWhatsAppMock();
    service = new CampaignsService(prisma as any, whatsapp as any);
  });

  describe("estimateCost", () => {
    it("computes the total from the segment size and the template category rate", async () => {
      prisma.segment.findFirst.mockResolvedValue({
        id: "seg-1",
        contacts: [makeContact("1"), makeContact("2"), makeContact("3")],
      });

      const estimate = await service.estimateCost({
        teamId: "team-1",
        segmentId: "seg-1",
        templateCategory: "MARKETING",
      });

      const perConversation = META_CONVERSATION_RATE_EUR_IT.MARKETING + PLATFORM_MARKUP_EUR;
      expect(estimate.recipientCount).toBe(3);
      expect(estimate.totalPerConversation).toBeCloseTo(perConversation, 4);
      expect(estimate.estimatedTotal).toBeCloseTo(perConversation * 3, 2);
    });

    it("throws when the segment does not belong to the team", async () => {
      prisma.segment.findFirst.mockResolvedValue(null);

      await expect(
        service.estimateCost({ teamId: "team-1", segmentId: "missing", templateCategory: "MARKETING" }),
      ).rejects.toThrow("Segment not found");
    });
  });

  describe("createCampaign", () => {
    it("refuses a template that Meta has not approved yet", async () => {
      prisma.segment.findFirst.mockResolvedValue({ id: "seg-1", contacts: [] });
      prisma.template.findFirst.mockResolvedValue({ id: "tpl-1", status: "PENDING_REVIEW", bodyText: "Ciao" });

      await expect(
        service.createCampaign({
          teamId: "team-1",
          name: "Promo",
          segmentId: "seg-1",
          templateId: "tpl-1",
          variableMapping: [],
          recurrence: "NONE",
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.campaign.create).not.toHaveBeenCalled();
    });
  });

  describe("sendCampaign", () => {
    const baseCampaign = {
      id: "camp-1",
      teamId: "team-1",
      name: "Promo estate",
      status: "DRAFT",
      scheduledAt: null,
      sentAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      recurrence: "NONE",
      recurrenceEndAt: null,
      variableMapping: [],
      templateId: "tpl-1",
      variantBTemplateId: null,
      template: { id: "tpl-1", name: "promo_estate", category: "MARKETING", language: "it", bodyText: "Ciao {{1}}" },
      variantBTemplate: null,
      segment: { id: "seg-1", name: "Tutti", contacts: [{ contact: makeContact("1") }, { contact: makeContact("2") }] },
    };

    it("refuses to send when the accepted estimate no longer matches", async () => {
      prisma.campaign.findFirst.mockResolvedValue(baseCampaign);
      prisma.segment.findFirst.mockResolvedValue({ id: "seg-1", contacts: baseCampaign.segment.contacts });

      await expect(
        service.sendCampaign({ teamId: "team-1", campaignId: "camp-1", acceptedCostEstimateTotal: 0 }),
      ).rejects.toThrow(ForbiddenException);

      expect(whatsapp.sendTemplateMessage).not.toHaveBeenCalled();
      expect(prisma.campaign.update).not.toHaveBeenCalled();
    });

    it("sends one message per recipient and marks the campaign SENT", async () => {
      prisma.campaign.findFirst.mockResolvedValue(baseCampaign);
      prisma.segment.findFirst.mockResolvedValue({ id: "seg-1", contacts: baseCampaign.segment.contacts });
      prisma.campaign.findUnique.mockResolvedValue(baseCampaign);
      prisma.campaign.findUniqueOrThrow.mockResolvedValue(baseCampaign);
      prisma.whatsAppConnection.findUnique.mockResolvedValue({
        phoneNumberId: "phone-1",
        accessTokenEncrypted: "token",
      });
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockImplementation(({ data }: any) => Promise.resolve({ id: `conv-${data.contactId}` }));
      prisma.message.create.mockImplementation(({ data }: any) => Promise.resolve({ id: `msg-${data.conversationId}` }));
      whatsapp.sendTemplateMessage.mockResolvedValue({ waMessageId: "wamid.ok" });

      const estimate = await service.estimateCost({
        teamId: "team-1",
        segmentId: "seg-1",
        templateCategory: "MARKETING",
      });

      await service.sendCampaign({
        teamId: "team-1",
        campaignId: "camp-1",
        acceptedCostEstimateTotal: estimate.estimatedTotal,
      });

      expect(whatsapp.sendTemplateMessage).toHaveBeenCalledTimes(2);
      expect(prisma.message.create).toHaveBeenCalledTimes(2);
      expect(prisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) }),
      );
    });

    it("marks the campaign FAILED when every send fails", async () => {
      prisma.campaign.findFirst.mockResolvedValue(baseCampaign);
      prisma.segment.findFirst.mockResolvedValue({ id: "seg-1", contacts: baseCampaign.segment.contacts });
      prisma.campaign.findUnique.mockResolvedValue(baseCampaign);
      prisma.campaign.findUniqueOrThrow.mockResolvedValue(baseCampaign);
      prisma.whatsAppConnection.findUnique.mockResolvedValue({
        phoneNumberId: "phone-1",
        accessTokenEncrypted: "token",
      });
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockImplementation(({ data }: any) => Promise.resolve({ id: `conv-${data.contactId}` }));
      prisma.message.create.mockImplementation(({ data }: any) => Promise.resolve({ id: `msg-${data.conversationId}` }));
      whatsapp.sendTemplateMessage.mockRejectedValue(new Error("Meta API down"));

      const estimate = await service.estimateCost({
        teamId: "team-1",
        segmentId: "seg-1",
        templateCategory: "MARKETING",
      });

      await service.sendCampaign({
        teamId: "team-1",
        campaignId: "camp-1",
        acceptedCostEstimateTotal: estimate.estimatedTotal,
      });

      expect(prisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
      );
    });

    it("replaces a URL variable with a unique tracking link per recipient", async () => {
      const campaignWithLink = {
        ...baseCampaign,
        template: { ...baseCampaign.template, bodyText: "Ciao {{1}}, prenota qui: {{2}}" },
        variableMapping: [
          { kind: "CONTACT_FIELD", value: "firstName", fallback: "" },
          { kind: "STATIC", value: "https://spokkio.example/prenota", fallback: "" },
        ],
      };
      prisma.campaign.findFirst.mockResolvedValue(campaignWithLink);
      prisma.segment.findFirst.mockResolvedValue({ id: "seg-1", contacts: campaignWithLink.segment.contacts });
      prisma.campaign.findUnique.mockResolvedValue(campaignWithLink);
      prisma.campaign.findUniqueOrThrow.mockResolvedValue(campaignWithLink);
      prisma.whatsAppConnection.findUnique.mockResolvedValue({
        phoneNumberId: "phone-1",
        accessTokenEncrypted: "token",
      });
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockImplementation(({ data }: any) => Promise.resolve({ id: `conv-${data.contactId}` }));
      prisma.message.create.mockImplementation(({ data }: any) => Promise.resolve({ id: `msg-${data.conversationId}` }));
      whatsapp.sendTemplateMessage.mockResolvedValue({ waMessageId: "wamid.ok" });

      const estimate = await service.estimateCost({
        teamId: "team-1",
        segmentId: "seg-1",
        templateCategory: "MARKETING",
      });

      await service.sendCampaign({
        teamId: "team-1",
        campaignId: "camp-1",
        acceptedCostEstimateTotal: estimate.estimatedTotal,
      });

      // Two recipients, one trackable URL variable each -> two distinct links.
      expect(prisma.trackedLink.create).toHaveBeenCalledTimes(2);
      const sentVariables = whatsapp.sendTemplateMessage.mock.calls.map((call: any[]) => call[0].variables[1]);
      expect(sentVariables[0]).toMatch(/^http:\/\/localhost:3001\/api\/v1\/t\//);
      expect(sentVariables[0]).not.toBe(sentVariables[1]);
      expect(prisma.message.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ text: expect.stringContaining("/api/v1/t/") }) }),
      );
    });
  });
});
