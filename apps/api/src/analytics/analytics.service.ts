import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CampaignStatsInput,
  CampaignStatsOutput,
  CampaignEventDrilldownInput,
  CampaignEventDrilldownOutput,
  AnalyticsRangeInput,
  AnalyticsOverviewOutput,
  AnalyticsTimeSeriesOutput,
  CampaignPerformanceOutput,
  AtRiskCustomersInput,
  AtRiskCustomerOutput,
  CampaignRecipientsInput,
  CampaignRecipientOutput,
  MessageCategory,
} from "@spokkio/shared";
import { MessageCategoryValues } from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";
import {
  META_CONVERSATION_RATE_EUR_IT,
  PLATFORM_MARKUP_EUR,
  computeBillableConversationsByCategory,
} from "../campaigns/pricing";

const DELIVERED_STATUSES = ["DELIVERED", "READ"];
// Una risposta conta per una campagna se arriva entro questi giorni dall'invio.
const REPLY_WINDOW_DAYS = 7;

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // Tool: analytics.campaignStats
  async campaignStats(input: CampaignStatsInput): Promise<CampaignStatsOutput> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: input.campaignId, teamId: input.teamId },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");

    const messages = await this.prisma.message.findMany({ where: { campaignId: campaign.id } });
    const clickedCount = await this.prisma.attributionEvent.count({
      where: { kind: "clicked", message: { campaignId: campaign.id } },
    });

    return {
      campaignId: campaign.id,
      sent: messages.filter((m) => m.status !== "QUEUED").length,
      delivered: messages.filter((m) => DELIVERED_STATUSES.includes(m.status)).length,
      read: messages.filter((m) => m.status === "READ").length,
      clicked: clickedCount,
      failed: messages.filter((m) => m.status === "FAILED").length,
    };
  }

  // Tool: analytics.campaignEventDrilldown — every aggregate number above
  // must be traceable back to this event-level list (no opaque ROI totals).
  async campaignEventDrilldown(input: CampaignEventDrilldownInput): Promise<CampaignEventDrilldownOutput> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: input.campaignId, teamId: input.teamId },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");

    const events = await this.prisma.attributionEvent.findMany({
      where: { kind: input.metric, message: { campaignId: campaign.id } },
      orderBy: { occurredAt: "desc" },
    });

    return events.map((e) => ({
      contactId: e.contactId,
      messageId: e.messageId,
      occurredAt: e.occurredAt.toISOString(),
      detail: e.detail,
    }));
  }

  // Tool: analytics.overview
  async overview(input: AnalyticsRangeInput): Promise<AnalyticsOverviewOutput> {
    const since = this.since(input.days);

    const [messages, inboundMessages, activeConversations] = await Promise.all([
      this.prisma.message.findMany({
        where: { direction: "OUTBOUND", createdAt: { gte: since }, conversation: { teamId: input.teamId } },
        select: { status: true, category: true, createdAt: true, conversation: { select: { contactId: true } } },
      }),
      this.prisma.message.count({
        where: { direction: "INBOUND", createdAt: { gte: since }, conversation: { teamId: input.teamId } },
      }),
      this.prisma.conversation.count({ where: { teamId: input.teamId, closedAt: null } }),
    ]);

    const clicked = await this.prisma.attributionEvent.count({
      where: {
        kind: "clicked",
        occurredAt: { gte: since },
        message: { conversation: { teamId: input.teamId } },
      },
    });

    const sent = messages.filter((m) => m.status !== "QUEUED").length;
    const delivered = messages.filter((m) => DELIVERED_STATUSES.includes(m.status)).length;
    const read = messages.filter((m) => m.status === "READ").length;
    const failed = messages.filter((m) => m.status === "FAILED").length;

    // Meta fattura una conversazione per finestra di 24h aperta per
    // (contatto, categoria), non per messaggio: due template marketing allo
    // stesso contatto nella stessa giornata sono UNA sola conversazione
    // fatturata, non due. Il conteggio qui sotto raggruppa i messaggi
    // effettivamente partiti per contatto+categoria e ricostruisce le
    // finestre reali, invece di contare ogni messaggio come se aprisse
    // sempre una nuova conversazione (vedi docs/RISKS.md per i limiti
    // residui rispetto a un'integrazione con le API di fatturazione Meta).
    const billableMessages = messages
      .filter((m) => m.status !== "QUEUED" && m.status !== "FAILED" && m.category)
      .map((m) => ({
        contactId: m.conversation.contactId,
        category: m.category as MessageCategory,
        createdAt: m.createdAt,
      }));
    const conversationsByCategory = computeBillableConversationsByCategory(billableMessages);

    const byCategory = MessageCategoryValues.map((category) => {
      const conversations = conversationsByCategory[category as MessageCategory] ?? 0;
      const ratePerConversation = META_CONVERSATION_RATE_EUR_IT[category as MessageCategory];
      return {
        category,
        conversations,
        ratePerConversation,
        metaTotal: Number((conversations * ratePerConversation).toFixed(2)),
      };
    }).filter((row) => row.conversations > 0);

    const billableConversations = byCategory.reduce((acc, row) => acc + row.conversations, 0);
    const metaTotal = Number(byCategory.reduce((acc, row) => acc + row.metaTotal, 0).toFixed(2));
    const markupTotal = Number((billableConversations * PLATFORM_MARKUP_EUR).toFixed(2));

    return {
      periodDays: input.days,
      sent,
      delivered,
      read,
      clicked,
      failed,
      inboundMessages,
      activeConversations,
      deliveryRate: rate(delivered, sent),
      readRate: rate(read, delivered),
      clickRate: rate(clicked, delivered),
      failureRate: rate(failed, sent + failed),
      cost: {
        metaTotal,
        markupTotal,
        total: Number((metaTotal + markupTotal).toFixed(2)),
        currency: "EUR",
        byCategory,
      },
    };
  }

  // Tool: analytics.timeSeries
  async timeSeries(input: AnalyticsRangeInput): Promise<AnalyticsTimeSeriesOutput> {
    const since = this.since(input.days);

    const messages = await this.prisma.message.findMany({
      where: { direction: "OUTBOUND", createdAt: { gte: since }, conversation: { teamId: input.teamId } },
      select: { createdAt: true, status: true, deliveredAt: true, readAt: true },
    });

    // Un giorno senza invii deve comunque comparire nella serie: altrimenti il
    // grafico "salta" i buchi e fa sembrare continuo un periodo che non lo è.
    const buckets = new Map<string, { sent: number; delivered: number; read: number; failed: number }>();
    for (let i = 0; i < input.days; i++) {
      const day = new Date(since);
      day.setDate(day.getDate() + i);
      buckets.set(isoDay(day), { sent: 0, delivered: 0, read: 0, failed: 0 });
    }

    for (const message of messages) {
      const bucket = buckets.get(isoDay(message.createdAt));
      if (!bucket) continue;
      if (message.status !== "QUEUED") bucket.sent++;
      if (DELIVERED_STATUSES.includes(message.status)) bucket.delivered++;
      if (message.status === "READ") bucket.read++;
      if (message.status === "FAILED") bucket.failed++;
    }

    return Array.from(buckets.entries()).map(([date, counts]) => ({ date, ...counts }));
  }

  // Tool: analytics.campaignPerformance
  async campaignPerformance(input: AnalyticsRangeInput): Promise<CampaignPerformanceOutput> {
    const since = this.since(input.days);

    const campaigns = await this.prisma.campaign.findMany({
      where: { teamId: input.teamId, createdAt: { gte: since } },
      include: {
        template: { select: { category: true } },
        segment: { include: { contacts: true } },
        messages: {
          select: { id: true, status: true, createdAt: true, conversation: { select: { contactId: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const clickCounts = await this.prisma.attributionEvent.groupBy({
      by: ["messageId"],
      where: { kind: "clicked", message: { campaign: { teamId: input.teamId } } },
      _count: { _all: true },
    });
    const clicksByMessage = new Map(clickCounts.map((c) => [c.messageId, c._count._all]));
    const replies = await this.findReplies(
      campaigns.flatMap((c) =>
        c.messages.map((m) => ({ id: m.id, contactId: m.conversation.contactId, createdAt: m.createdAt })),
      ),
    );

    return campaigns.map((campaign) => {
      const sent = campaign.messages.filter((m) => m.status !== "QUEUED").length;
      const delivered = campaign.messages.filter((m) => DELIVERED_STATUSES.includes(m.status)).length;
      const read = campaign.messages.filter((m) => m.status === "READ").length;
      const failed = campaign.messages.filter((m) => m.status === "FAILED").length;
      const replied = campaign.messages.filter((m) => replies.has(m.id)).length;
      const clicked = campaign.messages.reduce((acc, m) => acc + (clicksByMessage.get(m.id) ?? 0), 0);

      const billable = campaign.messages.filter((m) => m.status !== "QUEUED" && m.status !== "FAILED").length;
      const ratePerConversation =
        META_CONVERSATION_RATE_EUR_IT[campaign.template.category as MessageCategory] + PLATFORM_MARKUP_EUR;

      return {
        campaignId: campaign.id,
        name: campaign.name,
        sentAt: campaign.sentAt ? campaign.sentAt.toISOString() : null,
        status: campaign.status,
        recipients: campaign.segment.contacts.length,
        sent,
        delivered,
        read,
        clicked,
        failed,
        deliveryRate: rate(delivered, sent),
        readRate: rate(read, delivered),
        replied,
        replyRate: rate(replied, delivered),
        costTotal: Number((billable * ratePerConversation).toFixed(2)),
      };
    });
  }

  // Tool: analytics.campaignRecipients
  async campaignRecipients(input: CampaignRecipientsInput): Promise<CampaignRecipientOutput[]> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: input.campaignId, teamId: input.teamId },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");

    const messages = await this.prisma.message.findMany({
      where: { campaignId: campaign.id, direction: "OUTBOUND" },
      include: { conversation: { include: { contact: true } } },
      orderBy: { createdAt: "asc" },
    });
    const replies = await this.findReplies(
      messages.map((m) => ({ id: m.id, contactId: m.conversation.contactId, createdAt: m.createdAt })),
    );

    return messages.map((m) => {
      const contact = m.conversation.contact;
      const reply = replies.get(m.id);
      const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
      return {
        contactId: contact.id,
        name: name || null,
        phoneE164: contact.phoneE164,
        status: m.status,
        sentAt: m.createdAt.toISOString(),
        deliveredAt: m.deliveredAt ? m.deliveredAt.toISOString() : null,
        readAt: m.readAt ? m.readAt.toISOString() : null,
        failedReason: m.failedReason,
        repliedAt: reply ? reply.createdAt.toISOString() : null,
        replyText: reply ? reply.text : null,
      };
    });
  }

  // Per ogni messaggio inviato, la prima risposta dello stesso contatto
  // arrivata entro REPLY_WINDOW_DAYS. Una query sola per tutti i contatti.
  private async findReplies(sent: { id: string; contactId: string; createdAt: Date }[]) {
    const result = new Map<string, { createdAt: Date; text: string }>();
    if (sent.length === 0) return result;

    const earliest = new Date(Math.min(...sent.map((m) => m.createdAt.getTime())));
    const inbound = await this.prisma.message.findMany({
      where: {
        direction: "INBOUND",
        createdAt: { gt: earliest },
        conversation: { contactId: { in: [...new Set(sent.map((m) => m.contactId))] } },
      },
      select: { createdAt: true, text: true, conversation: { select: { contactId: true } } },
      orderBy: { createdAt: "asc" },
    });

    const windowMs = REPLY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    for (const message of sent) {
      const reply = inbound.find(
        (r) =>
          r.conversation.contactId === message.contactId &&
          r.createdAt > message.createdAt &&
          r.createdAt.getTime() - message.createdAt.getTime() <= windowMs,
      );
      if (reply) result.set(message.id, { createdAt: reply.createdAt, text: reply.text });
    }
    return result;
  }

  // Tool: analytics.atRiskCustomers — un contatto entra in questa lista solo
  // se ha già avuto almeno una conversazione reale (altrimenti è semplicemente
  // "mai contattato", un problema diverso) e non dà segnali di attività da
  // più del periodo scelto.
  async atRiskCustomers(input: AtRiskCustomersInput): Promise<AtRiskCustomerOutput[]> {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - input.inactivityDays);

    const contacts = await this.prisma.contact.findMany({
      where: {
        teamId: input.teamId,
        lastActivityAt: { lt: threshold },
        conversations: { some: {} },
      },
      orderBy: { lastActivityAt: "asc" },
      take: 100,
    });

    const now = Date.now();
    return contacts.map((c) => ({
      contactId: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
      phoneE164: c.phoneE164,
      categories: c.categories,
      lastActivityAt: c.lastActivityAt.toISOString(),
      daysSinceActivity: Math.floor((now - c.lastActivityAt.getTime()) / (24 * 60 * 60 * 1000)),
    }));
  }

  private since(days: number): Date {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (days - 1));
    return date;
  }
}

function rate(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Number(((part / whole) * 100).toFixed(1));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
