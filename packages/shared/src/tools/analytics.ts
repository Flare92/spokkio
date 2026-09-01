import { z } from "zod";

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

export const ANALYTICS_TOOLS = {
  "analytics.campaignStats": { input: CampaignStatsInput, output: CampaignStatsOutput },
  "analytics.campaignEventDrilldown": {
    input: CampaignEventDrilldownInput,
    output: CampaignEventDrilldownOutput,
  },
} as const;
