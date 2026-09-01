import { z } from "zod";
import { PlanTierValues } from "../enums";

export const PlanStatusInput = z.object({ teamId: z.string().uuid() });
export type PlanStatusInput = z.infer<typeof PlanStatusInput>;

// Single plan, single invoice line item + one transparent conversation markup.
// No second "wallet" balance ever appears in this schema — that's deliberate.
export const PlanStatusOutput = z.object({
  teamId: z.string().uuid(),
  tier: z.enum(PlanTierValues),
  monthlyFeeEur: z.number().nonnegative(),
  conversationsIncluded: z.number().int(),
  conversationsUsedThisPeriod: z.number().int(),
  periodEnd: z.string().datetime(),
  // Proactive alert threshold (%) — never a hard cutoff or shock overage.
  usageAlertThresholdPct: z.number().min(0).max(100),
  pendingPlanChange: z
    .object({
      effectiveAt: z.string().datetime(), // must be >= now + 7 days
      newMonthlyFeeEur: z.number().nonnegative(),
      notifiedAt: z.string().datetime(),
    })
    .nullable(),
});
export type PlanStatusOutput = z.infer<typeof PlanStatusOutput>;

export const BILLING_TOOLS = {
  "billing.planStatus": { input: PlanStatusInput, output: PlanStatusOutput },
} as const;
