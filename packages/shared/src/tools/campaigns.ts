import { z } from "zod";
import { MessageCategoryValues } from "../enums";

export const CostEstimateInput = z.object({
  teamId: z.string().uuid(),
  segmentId: z.string().uuid(),
  templateCategory: z.enum(MessageCategoryValues),
});
export type CostEstimateInput = z.infer<typeof CostEstimateInput>;

// The cost simulator is a first-class tool, not a UI-only widget, so it can be
// called before every send and embedded in onboarding — see constraint: no
// surprise invoices, always show a realistic pre-purchase cost scenario.
export const CostEstimateOutput = z.object({
  recipientCount: z.number().int(),
  metaCostPerConversation: z.number().nonnegative(),
  platformMarkupPerConversation: z.number().nonnegative(),
  totalPerConversation: z.number().nonnegative(),
  estimatedTotal: z.number().nonnegative(),
  currency: z.literal("EUR"),
  breakdown: z.object({
    metaTotal: z.number().nonnegative(),
    markupTotal: z.number().nonnegative(),
  }),
});
export type CostEstimateOutput = z.infer<typeof CostEstimateOutput>;

export const CreateCampaignInput = z.object({
  teamId: z.string().uuid(),
  name: z.string().min(1),
  segmentId: z.string().uuid(),
  templateId: z.string().uuid(),
  scheduledAt: z.string().datetime().optional(),
});
export type CreateCampaignInput = z.infer<typeof CreateCampaignInput>;

export const CampaignOutput = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  recipientCount: z.number().int(),
  scheduledAt: z.string().datetime().nullable(),
});
export type CampaignOutput = z.infer<typeof CampaignOutput>;

export const SendCampaignInput = z.object({
  teamId: z.string().uuid(),
  campaignId: z.string().uuid(),
  // Sending requires the caller to have already seen (and accepted) the cost
  // estimate for this exact send — enforced server-side, never skippable.
  acceptedCostEstimateTotal: z.number().nonnegative(),
});
export type SendCampaignInput = z.infer<typeof SendCampaignInput>;

export const CAMPAIGNS_TOOLS = {
  "campaigns.estimateCost": { input: CostEstimateInput, output: CostEstimateOutput },
  "campaigns.create": { input: CreateCampaignInput, output: CampaignOutput },
  "campaigns.send": { input: SendCampaignInput, output: CampaignOutput },
} as const;
