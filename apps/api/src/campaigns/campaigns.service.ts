import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  CostEstimateInput,
  CostEstimateOutput,
  CreateCampaignInput,
  CampaignOutput,
  SendCampaignInput,
  ListCampaignsInput,
  PreviewCampaignInput,
  PreviewCampaignOutput,
  CancelScheduledCampaignInput,
  VariableSource,
} from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppService } from "../whatsapp/whatsapp.service";
import { META_CONVERSATION_RATE_EUR_IT, PLATFORM_MARKUP_EUR } from "./pricing";
import { countTemplateVariables, renderTemplate } from "./render";

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

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

  // Tool: campaigns.preview
  async previewCampaign(input: PreviewCampaignInput): Promise<PreviewCampaignOutput> {
    const [segment, template] = await Promise.all([
      this.prisma.segment.findFirst({
        where: { id: input.segmentId, teamId: input.teamId },
        include: { contacts: { include: { contact: true }, take: input.limit } },
      }),
      this.prisma.template.findFirst({ where: { id: input.templateId, teamId: input.teamId } }),
    ]);
    if (!segment) throw new NotFoundException("Segment not found");
    if (!template) throw new NotFoundException("Template not found");

    return segment.contacts.map(({ contact }) => {
      const rendered = renderTemplate(template.bodyText, input.variableMapping, contact);
      return {
        contactId: contact.id,
        phoneE164: contact.phoneE164,
        renderedText: rendered.text,
        missingVariables: rendered.missingVariables,
      };
    });
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

    const requiredVariables = countTemplateVariables(template.bodyText);
    if (input.variableMapping.length < requiredVariables) {
      throw new BadRequestException(
        `Il template usa ${requiredVariables} variabili ma ne sono state mappate ${input.variableMapping.length}`,
      );
    }

    if (input.scheduledAt && new Date(input.scheduledAt).getTime() <= Date.now()) {
      throw new BadRequestException("La data di invio programmato deve essere nel futuro");
    }

    const campaign = await this.prisma.campaign.create({
      data: {
        teamId: input.teamId,
        name: input.name,
        segmentId: input.segmentId,
        templateId: input.templateId,
        status: input.scheduledAt ? "SCHEDULED" : "DRAFT",
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        variableMapping: input.variableMapping as unknown as object,
      },
      include: { template: true, segment: { include: { contacts: true } } },
    });

    return this.toOutput(campaign);
  }

  // Tool: campaigns.list
  async listCampaigns(input: ListCampaignsInput): Promise<CampaignOutput[]> {
    const campaigns = await this.prisma.campaign.findMany({
      where: { teamId: input.teamId },
      include: { template: true, segment: { include: { contacts: true } } },
      orderBy: { createdAt: "desc" },
    });
    return campaigns.map((c) => this.toOutput(c));
  }

  // Tool: campaigns.cancelScheduled
  async cancelScheduled(input: CancelScheduledCampaignInput): Promise<CampaignOutput> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: input.campaignId, teamId: input.teamId },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");
    if (campaign.status !== "SCHEDULED") {
      throw new BadRequestException("Solo una campagna programmata può essere annullata");
    }

    const updated = await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "DRAFT", scheduledAt: null },
      include: { template: true, segment: { include: { contacts: true } } },
    });
    return this.toOutput(updated);
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

    await this.deliverCampaign(campaign.id);

    const refreshed = await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { acceptedCostEstimateTotal: input.acceptedCostEstimateTotal },
      include: { template: true, segment: { include: { contacts: true } } },
    });
    return this.toOutput(refreshed);
  }

  // Invio effettivo, condiviso fra invio immediato e invio programmato.
  async deliverCampaign(campaignId: string): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { segment: { include: { contacts: { include: { contact: true } } } }, template: true },
    });
    if (!campaign) return;

    const waConnection = await this.prisma.whatsAppConnection.findUnique({
      where: { teamId: campaign.teamId },
    });
    if (!waConnection) throw new BadRequestException("No WhatsApp connection configured for this team");

    await this.prisma.campaign.update({ where: { id: campaign.id }, data: { status: "SENDING" } });

    const mapping = (campaign.variableMapping as unknown as VariableSource[]) ?? [];
    let failures = 0;

    for (const { contact } of campaign.segment.contacts) {
      try {
        const rendered = renderTemplate(campaign.template.bodyText, mapping, contact);
        const conversation = await this.getOrCreateConversation(campaign.teamId, contact.id);
        const message = await this.prisma.message.create({
          data: {
            conversationId: conversation.id,
            campaignId: campaign.id,
            direction: "OUTBOUND",
            category: campaign.template.category,
            // Il testo salvato è quello personalizzato per questo destinatario.
            text: rendered.text,
            status: "QUEUED",
          },
        });

        const result = await this.whatsapp.sendTemplateMessage({
          phoneNumberId: waConnection.phoneNumberId,
          accessToken: waConnection.accessTokenEncrypted, // decrypt in a real KMS-backed impl
          toE164: contact.phoneE164,
          templateName: campaign.template.name,
          language: campaign.template.language,
          variables: rendered.values,
          category: campaign.template.category,
        });

        await this.prisma.message.update({
          where: { id: message.id },
          data: { waMessageId: result.waMessageId, status: "SENT" },
        });
      } catch (err) {
        failures++;
        this.logger.warn(
          `Invio fallito verso ${contact.phoneE164}: ${err instanceof Error ? err.message : "errore sconosciuto"}`,
        );
      }
    }

    const total = campaign.segment.contacts.length;
    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: failures === total && total > 0 ? "FAILED" : "SENT", sentAt: new Date() },
    });
  }

  private async getOrCreateConversation(teamId: string, contactId: string) {
    const existing = await this.prisma.conversation.findFirst({ where: { contactId, closedAt: null } });
    if (existing) return existing;
    return this.prisma.conversation.create({ data: { teamId, contactId } });
  }

  private toOutput(campaign: {
    id: string;
    name: string;
    status: string;
    scheduledAt: Date | null;
    sentAt: Date | null;
    createdAt: Date;
    template: { name: string };
    segment: { name: string; contacts: unknown[] };
  }): CampaignOutput {
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      recipientCount: campaign.segment.contacts.length,
      scheduledAt: campaign.scheduledAt ? campaign.scheduledAt.toISOString() : null,
      sentAt: campaign.sentAt ? campaign.sentAt.toISOString() : null,
      templateName: campaign.template.name,
      segmentName: campaign.segment.name,
      createdAt: campaign.createdAt.toISOString(),
    };
  }
}
