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
  DuplicateCampaignInput,
  ABTestResultsInput,
  ABTestResultsOutput,
  ABVariantStats,
  VariableSource,
} from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppService } from "../whatsapp/whatsapp.service";
import { META_CONVERSATION_RATE_EUR_IT, PLATFORM_MARKUP_EUR } from "./pricing";
import { countTemplateVariables, renderTemplate } from "./render";

const DELIVERED_STATUSES = ["DELIVERED", "READ"];

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
    const [segment, template, variantBTemplate] = await Promise.all([
      this.prisma.segment.findFirst({
        where: { id: input.segmentId, teamId: input.teamId },
        include: { contacts: true },
      }),
      this.prisma.template.findFirst({ where: { id: input.templateId, teamId: input.teamId } }),
      input.variantBTemplateId
        ? this.prisma.template.findFirst({ where: { id: input.variantBTemplateId, teamId: input.teamId } })
        : Promise.resolve(null),
    ]);
    if (!segment) throw new NotFoundException("Segment not found");
    if (!template) throw new NotFoundException("Template not found");
    if (template.status !== "APPROVED") {
      throw new BadRequestException("Template must be APPROVED by Meta before it can be used in a campaign");
    }
    if (input.variantBTemplateId && !variantBTemplate) throw new NotFoundException("Variant B template not found");
    if (variantBTemplate && variantBTemplate.status !== "APPROVED") {
      throw new BadRequestException("La variante B deve essere anch'essa un template APPROVED");
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
    if (input.recurrence !== "NONE" && !input.scheduledAt) {
      throw new BadRequestException("Una campagna ricorrente richiede una data di primo invio");
    }

    const campaign = await this.prisma.campaign.create({
      data: {
        teamId: input.teamId,
        name: input.name,
        segmentId: input.segmentId,
        templateId: input.templateId,
        variantBTemplateId: input.variantBTemplateId ?? null,
        status: input.scheduledAt ? "SCHEDULED" : "DRAFT",
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        variableMapping: input.variableMapping as unknown as object,
        recurrence: input.recurrence,
        recurrenceEndAt: input.recurrenceEndAt ? new Date(input.recurrenceEndAt) : null,
      },
      include: { template: true, variantBTemplate: true, segment: { include: { contacts: true } } },
    });

    return this.toOutput(campaign);
  }

  // Tool: campaigns.duplicate — riparte da zero come bozza: nome, segmento,
  // template e mappatura variabili copiati, nessuna programmazione né
  // ricorrenza ereditata (l'utente le decide di nuovo consapevolmente).
  async duplicateCampaign(input: DuplicateCampaignInput): Promise<CampaignOutput> {
    const original = await this.prisma.campaign.findFirst({
      where: { id: input.campaignId, teamId: input.teamId },
    });
    if (!original) throw new NotFoundException("Campaign not found");

    const copy = await this.prisma.campaign.create({
      data: {
        teamId: input.teamId,
        name: `Copia di ${original.name}`,
        segmentId: original.segmentId,
        templateId: original.templateId,
        variantBTemplateId: original.variantBTemplateId,
        variableMapping: original.variableMapping as object,
        status: "DRAFT",
      },
      include: { template: true, variantBTemplate: true, segment: { include: { contacts: true } } },
    });

    return this.toOutput(copy);
  }

  // Tool: campaigns.abTestResults
  async abTestResults(input: ABTestResultsInput): Promise<ABTestResultsOutput> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: input.campaignId, teamId: input.teamId },
      include: { template: true, variantBTemplate: true, messages: true },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");

    const clickCounts = await this.prisma.attributionEvent.groupBy({
      by: ["messageId"],
      where: { kind: "clicked", message: { campaignId: campaign.id } },
      _count: { _all: true },
    });
    const clickedMessageIds = new Set(clickCounts.map((c) => c.messageId));

    const variantStats = (variant: "A" | "B" | null, templateId: string, templateName: string): ABVariantStats => {
      const messages = campaign.messages.filter((m) => (variant === "A" ? m.abVariant !== "B" : m.abVariant === "B"));
      const sent = messages.filter((m) => m.status !== "QUEUED").length;
      const delivered = messages.filter((m) => DELIVERED_STATUSES.includes(m.status)).length;
      const read = messages.filter((m) => m.status === "READ").length;
      const clicked = messages.filter((m) => clickedMessageIds.has(m.id)).length;
      return {
        templateId,
        templateName,
        sent,
        delivered,
        read,
        clicked,
        deliveryRate: rate(delivered, sent),
        readRate: rate(read, delivered),
      };
    };

    return {
      variantA: variantStats(campaign.variantBTemplateId ? "A" : null, campaign.templateId, campaign.template.name),
      variantB: campaign.variantBTemplate
        ? variantStats("B", campaign.variantBTemplateId!, campaign.variantBTemplate.name)
        : null,
    };
  }

  // Tool: campaigns.list
  async listCampaigns(input: ListCampaignsInput): Promise<CampaignOutput[]> {
    const campaigns = await this.prisma.campaign.findMany({
      where: { teamId: input.teamId },
      include: { template: true, variantBTemplate: true, segment: { include: { contacts: true } } },
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
      data: { status: "DRAFT", scheduledAt: null, recurrence: "NONE", recurrenceEndAt: null },
      include: { template: true, variantBTemplate: true, segment: { include: { contacts: true } } },
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

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { acceptedCostEstimateTotal: input.acceptedCostEstimateTotal },
    });
    await this.deliverCampaign(campaign.id);

    const refreshed = await this.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
      include: { template: true, variantBTemplate: true, segment: { include: { contacts: true } } },
    });
    return this.toOutput(refreshed);
  }

  // Invio effettivo, condiviso fra invio immediato e invio programmato. Se
  // la campagna ha una variante B, i destinatari vengono divisi a metà (a
  // caso) fra le due; se ha una ricorrenza, alla fine genera la prossima
  // occorrenza come nuova campagna programmata.
  async deliverCampaign(campaignId: string): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        segment: { include: { contacts: { include: { contact: true } } } },
        template: true,
        variantBTemplate: true,
      },
    });
    if (!campaign) return;

    const waConnection = await this.prisma.whatsAppConnection.findUnique({
      where: { teamId: campaign.teamId },
    });
    if (!waConnection) throw new BadRequestException("No WhatsApp connection configured for this team");

    await this.prisma.campaign.update({ where: { id: campaign.id }, data: { status: "SENDING" } });

    const mapping = (campaign.variableMapping as unknown as VariableSource[]) ?? [];
    const recipients = splitForABTest(campaign.segment.contacts, !!campaign.variantBTemplate);
    let failures = 0;

    for (const { contact, variant } of recipients) {
      const template = variant === "B" && campaign.variantBTemplate ? campaign.variantBTemplate : campaign.template;
      try {
        const rendered = renderTemplate(template.bodyText, mapping, contact);
        const conversation = await this.getOrCreateConversation(campaign.teamId, contact.id);
        const message = await this.prisma.message.create({
          data: {
            conversationId: conversation.id,
            campaignId: campaign.id,
            abVariant: campaign.variantBTemplate ? variant : null,
            direction: "OUTBOUND",
            category: template.category,
            // Il testo salvato è quello personalizzato per questo destinatario.
            text: rendered.text,
            status: "QUEUED",
          },
        });

        const result = await this.whatsapp.sendTemplateMessage({
          phoneNumberId: waConnection.phoneNumberId,
          accessToken: waConnection.accessTokenEncrypted, // decrypt in a real KMS-backed impl
          toE164: contact.phoneE164,
          templateName: template.name,
          language: template.language,
          variables: rendered.values,
          category: template.category,
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

    if (campaign.recurrence !== "NONE") {
      await this.scheduleNextOccurrence(campaign);
    }
  }

  // Crea la prossima occorrenza di una campagna ricorrente come riga a sé,
  // così ogni invio mantiene le proprie statistiche separate.
  private async scheduleNextOccurrence(campaign: {
    id: string;
    teamId: string;
    name: string;
    segmentId: string;
    templateId: string;
    variantBTemplateId: string | null;
    variableMapping: unknown;
    scheduledAt: Date | null;
    recurrence: string;
    recurrenceEndAt: Date | null;
  }): Promise<void> {
    const base = campaign.scheduledAt ?? new Date();
    const next = new Date(base);
    if (campaign.recurrence === "DAILY") next.setDate(next.getDate() + 1);
    else if (campaign.recurrence === "WEEKLY") next.setDate(next.getDate() + 7);
    else if (campaign.recurrence === "MONTHLY") next.setMonth(next.getMonth() + 1);
    else return;

    if (campaign.recurrenceEndAt && next > campaign.recurrenceEndAt) {
      this.logger.log(`Ricorrenza di "${campaign.name}" conclusa (oltre la data di fine impostata)`);
      return;
    }

    await this.prisma.campaign.create({
      data: {
        teamId: campaign.teamId,
        name: campaign.name,
        segmentId: campaign.segmentId,
        templateId: campaign.templateId,
        variantBTemplateId: campaign.variantBTemplateId,
        variableMapping: campaign.variableMapping as object,
        status: "SCHEDULED",
        scheduledAt: next,
        recurrence: campaign.recurrence,
        recurrenceEndAt: campaign.recurrenceEndAt,
      },
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
    recurrence: string;
    recurrenceEndAt: Date | null;
    template: { name: string };
    variantBTemplate: { name: string } | null;
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
      variantBTemplateName: campaign.variantBTemplate?.name ?? null,
      recurrence: campaign.recurrence as CampaignOutput["recurrence"],
      recurrenceEndAt: campaign.recurrenceEndAt ? campaign.recurrenceEndAt.toISOString() : null,
    };
  }
}

function rate(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Number(((part / whole) * 100).toFixed(1));
}

// Divide i destinatari a metà in modo deterministico sull'id del contatto
// (non a runtime-random), così rilanciare l'invio dopo un errore parziale
// non rimescola le assegnazioni già fatte.
function splitForABTest<T extends { contact: { id: string } }>(
  entries: T[],
  hasVariantB: boolean,
): (T & { variant: "A" | "B" })[] {
  if (!hasVariantB) return entries.map((e) => ({ ...e, variant: "A" as const }));
  return entries.map((e) => ({ ...e, variant: hashToBucket(e.contact.id) }));
}

function hashToBucket(id: string): "A" | "B" {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 2 === 0 ? "A" : "B";
}
