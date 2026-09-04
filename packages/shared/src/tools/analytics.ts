import { z } from "zod";
import { MessageCategoryValues } from "../enums";

export const CampaignStatsInput = z.object({
  teamId: z.string().uuid(),
  campaignId: z.string().uuid(),
});
export type CampaignStatsInput = z.infer<typeof CampaignStatsInput>;

export const CampaignStatsOutput = z.object({
  campaignId: z.string().uuid(),
  sent: z.number().int(),
  delivered: z.number().int(),
  read: z.number().int(),
  clicked: z.number().int(),
  failed: z.number().int(),
});
export type CampaignStatsOutput = z.infer<typeof CampaignStatsOutput>;

// Every aggregate stat must support drill-down to the underlying events —
// no opaque ROI numbers (product constraint: inspectable methodology).
export const CampaignEventDrilldownInput = z.object({
  teamId: z.string().uuid(),
  campaignId: z.string().uuid(),
  metric: z.enum(["delivered", "read", "clicked", "failed"]),
});
export type CampaignEventDrilldownInput = z.infer<typeof CampaignEventDrilldownInput>;

export const CampaignEventDrilldownOutput = z.array(
  z.object({
    contactId: z.string().uuid(),
    messageId: z.string().uuid(),
    occurredAt: z.string().datetime(),
    detail: z.string().nullable(),
  }),
);
export type CampaignEventDrilldownOutput = z.infer<typeof CampaignEventDrilldownOutput>;

export const AnalyticsRangeInput = z.object({
  teamId: z.string().uuid(),
  days: z.number().int().min(1).max(365).default(30),
});
export type AnalyticsRangeInput = z.infer<typeof AnalyticsRangeInput>;

// I costi sono calcolati sommando le tariffe per categoria dei messaggi
// effettivamente inviati: nessun totale "di comodo", ogni euro qui è
// riconducibile alle conversazioni che lo hanno generato.
export const AnalyticsOverviewOutput = z.object({
  periodDays: z.number().int(),
  sent: z.number().int(),
  delivered: z.number().int(),
  read: z.number().int(),
  clicked: z.number().int(),
  failed: z.number().int(),
  inboundMessages: z.number().int(),
  activeConversations: z.number().int(),
  deliveryRate: z.number(),
  readRate: z.number(),
  clickRate: z.number(),
  failureRate: z.number(),
  cost: z.object({
    metaTotal: z.number(),
    markupTotal: z.number(),
    total: z.number(),
    currency: z.literal("EUR"),
    byCategory: z.array(
      z.object({
        category: z.enum(MessageCategoryValues),
        conversations: z.number().int(),
        ratePerConversation: z.number(),
        metaTotal: z.number(),
      }),
    ),
  }),
});
export type AnalyticsOverviewOutput = z.infer<typeof AnalyticsOverviewOutput>;

export const AnalyticsTimeSeriesOutput = z.array(
  z.object({
    date: z.string(), // YYYY-MM-DD
    sent: z.number().int(),
    delivered: z.number().int(),
    read: z.number().int(),
    failed: z.number().int(),
  }),
);
export type AnalyticsTimeSeriesOutput = z.infer<typeof AnalyticsTimeSeriesOutput>;

export const CampaignPerformanceOutput = z.array(
  z.object({
    campaignId: z.string().uuid(),
    name: z.string(),
    sentAt: z.string().datetime().nullable(),
    status: z.string(),
    recipients: z.number().int(),
    sent: z.number().int(),
    delivered: z.number().int(),
    read: z.number().int(),
    clicked: z.number().int(),
    failed: z.number().int(),
    deliveryRate: z.number(),
    readRate: z.number(),
    costTotal: z.number(),
  }),
);
export type CampaignPerformanceOutput = z.infer<typeof CampaignPerformanceOutput>;

export const ANALYTICS_TOOLS = {
  "analytics.campaignStats": { input: CampaignStatsInput, output: CampaignStatsOutput },
  "analytics.campaignEventDrilldown": {
    input: CampaignEventDrilldownInput,
    output: CampaignEventDrilldownOutput,
  },
  "analytics.overview": { input: AnalyticsRangeInput, output: AnalyticsOverviewOutput },
  "analytics.timeSeries": { input: AnalyticsRangeInput, output: AnalyticsTimeSeriesOutput },
  "analytics.campaignPerformance": { input: AnalyticsRangeInput, output: CampaignPerformanceOutput },
} as const;
