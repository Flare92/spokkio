import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CampaignStatsInput,
  CampaignStatsOutput,
  CampaignEventDrilldownInput,
  CampaignEventDrilldownOutput,
} from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";

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
      delivered: messages.filter((m) => ["DELIVERED", "READ"].includes(m.status)).length,
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

    const kindMap: Record<typeof input.metric, string> = {
      delivered: "delivered",
      read: "read",
      clicked: "clicked",
      failed: "failed",
    };

    const events = await this.prisma.attributionEvent.findMany({
      where: { kind: kindMap[input.metric], message: { campaignId: campaign.id } },
      orderBy: { occurredAt: "desc" },
    });

    return events.map((e) => ({
      contactId: e.contactId,
      messageId: e.messageId,
      occurredAt: e.occurredAt.toISOString(),
      detail: e.detail,
    }));
  }
}
