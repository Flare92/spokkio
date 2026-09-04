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
  MessageCategory,
} from "@spokkio/shared";
import { MessageCategoryValues } from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";
import { META_CONVERSATION_RATE_EUR_IT, PLATFORM_MARKUP_EUR } from "../campaigns/pricing";

const DELIVERED_STATUSES = ["DELIVERED", "READ"];

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
        select: { status: true, category: true },
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

    // Meta fattura per conversazione avviata, non per messaggio: qui contiamo
    // i messaggi effettivamente partiti raggruppati per categoria, che è
    // l'approssimazione onesta finché non leggiamo i costi reali dalle API di
    // fatturazione di Meta (vedi docs/RISKS.md).
    const byCategory = MessageCategoryValues.map((category) => {
      const conversations = messages.filter(
        (m) => m.category === category && m.status !== "QUEUED" && m.status !== "FAILED",
      ).length;
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
        messages: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const clickCounts = await this.prisma.attributionEvent.groupBy({
      by: ["messageId"],
      where: { kind: "clicked", message: { campaign: { teamId: input.teamId } } },
      _count: { _all: true },
    });
    const clicksByMessage = new Map(clickCounts.map((c) => [c.messageId, c._count._all]));

    return campaigns.map((campaign) => {
      const sent = campaign.messages.filter((m) => m.status !== "QUEUED").length;
      const delivered = campaign.messages.filter((m) => DELIVERED_STATUSES.includes(m.status)).length;
      const read = campaign.messages.filter((m) => m.status === "READ").length;
      const failed = campaign.messages.filter((m) => m.status === "FAILED").length;
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
        costTotal: Number((billable * ratePerConversation).toFixed(2)),
      };
    });
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
