import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CostEstimateInput,
  CostEstimateOutput,
  CreateCampaignInput,
  CampaignOutput,
  SendCampaignInput,
} from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppService } from "../whatsapp/whatsapp.service";
import { META_CONVERSATION_RATE_EUR_IT, PLATFORM_MARKUP_EUR } from "./pricing";

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  // Tool: campaigns.estimateCost — must be called, and its result accepted,
  // before campaigns.send will execute (see SendCampaignInput contract).
  async estimateCost(input: CostEstimateInput): Promise<CostEstimateOutput> {
    const segment = await this.prisma.segment.findFirst({
      where: { id: input.segmentId, teamId: input.teamId },
      include: { contacts: true },
    });
    if (!segment) throw new NotFoundException("Segment not found");

    const recipientCount = segment.contacts.length;
    const metaCostPerConversation = META_CONVERSATION_RATE_EUR_IT[input.templateCategory];
    const markup = PLATFORM_MARKUP_EUR;
    const totalPerConversation = metaCostPerConversation + markup;

    return {
      recipientCount,
      metaCostPerConversation,
      platformMarkupPerConversation: markup,
      totalPerConversation,
      estimatedTotal: Number((totalPerConversation * recipientCount).toFixed(2)),
      currency: "EUR",
      breakdown: {
        metaTotal: Number((metaCostPerConversation * recipientCount).toFixed(2)),
        markupTotal: Number((markup * recipientCount).toFixed(2)),
      },
    };
  }

  // Tool: campaigns.create
  async createCampaign(input: CreateCampaignInput): Promise<CampaignOutput> {
    const [segment, template] = await Promise.all([
      this.prisma.segment.findFirst({
        where: { id: input.segmentId, teamId: input.teamId },
        include: { contacts: true },
      }),
      this.prisma.template.findFirst({ where: { id: input.templateId, teamId: input.teamId } }),
    ]);
    if (!segment) throw new NotFoundException("Segment not found");
    if (!template) throw new NotFoundException("Template not found");
    if (template.status !== "APPROVED") {
      throw new BadRequestException("Template must be APPROVED by Meta before it can be used in a campaign");
    }

    const campaign = await this.prisma.campaign.create({
      data: {
        teamId: input.teamId,
        name: input.name,
        segmentId: input.segmentId,
        templateId: input.templateId,
        status: input.scheduledAt ? "SCHEDULED" : "DRAFT",
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      },
    });

    return this.toOutput(campaign, segment.contacts.length);
  }

  // Tool: campaigns.send
  // Enforces that the caller already saw and accepted the exact cost
  // estimate for this send — the transparency constraint is not optional UX,
  // it is a server-side precondition.
  async sendCampaign(input: SendCampaignInput): Promise<CampaignOutput> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: input.campaignId, teamId: input.teamId },
      include: { segment: { include: { contacts: { include: { contact: true } } } }, template: true },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");
    if (campaign.status === "SENT" || campaign.status === "SENDING") {
      throw new BadRequestException("Campaign already sent or sending");
    }

    const estimate = await this.estimateCost({
      teamId: input.teamId,
      segmentId: campaign.segmentId,
      templateCategory: campaign.template.category,
    });
    if (Math.abs(estimate.estimatedTotal - input.acceptedCostEstimateTotal) > 0.01) {
      throw new ForbiddenException(
        "Accepted cost estimate does not match the current estimate for this campaign — re-fetch campaigns.estimateCost and confirm again",
      );
    }

    const waConnection = await this.prisma.whatsAppConnection.findUnique({
      where: { teamId: input.teamId },
    });
    if (!waConnection) throw new BadRequestException("No WhatsApp connection configured for this team");

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "SENDING", acceptedCostEstimateTotal: input.acceptedCostEstimateTotal },
    });

    let failures = 0;
    for (const { contact } of campaign.segment.contacts) {
      try {
        const conversation = await this.getOrCreateConversation(input.teamId, contact.id);
        const message = await this.prisma.message.create({
          data: {
            conversationId: conversation.id,
            campaignId: campaign.id,
            direction: "OUTBOUND",
            category: campaign.template.category,
            text: campaign.template.bodyText,
            status: "QUEUED",
          },
        });

        const result = await this.whatsapp.sendTemplateMessage({
          phoneNumberId: waConnection.phoneNumberId,
          accessToken: waConnection.accessTokenEncrypted, // decrypt in a real KMS-backed impl
          toE164: contact.phoneE164,
          templateName: campaign.template.name,
          language: campaign.template.language,
          variables: [],
          category: campaign.template.category,
        });

        await this.prisma.message.update({
          where: { id: message.id },
          data: { waMessageId: result.waMessageId, status: "SENT" },
        });
      } catch {
        failures++;
      }
    }

    const finalStatus = failures === campaign.segment.contacts.length && failures > 0 ? "FAILED" : "SENT";
    const updated = await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: finalStatus, sentAt: new Date() },
    });

    return this.toOutput(updated, campaign.segment.contacts.length);
  }

  private async getOrCreateConversation(teamId: string, contactId: string) {
    const existing = await this.prisma.conversation.findFirst({ where: { contactId, closedAt: null } });
    if (existing) return existing;
    return this.prisma.conversation.create({ data: { teamId, contactId } });
  }

  private toOutput(
    campaign: { id: string; name: string; status: string; scheduledAt: Date | null },
    recipientCount: number,
  ): CampaignOutput {
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      recipientCount,
      scheduledAt: campaign.scheduledAt ? campaign.scheduledAt.toISOString() : null,
    };
  }
}
