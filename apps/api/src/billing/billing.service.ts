import { Injectable, NotFoundException } from "@nestjs/common";
import type { PlanStatusInput, PlanStatusOutput } from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  // Tool: billing.planStatus — single plan, one invoice line, no wallet
  // balance. Any pending plan/price change must already be >=7 days out and
  // already notified (enforced when the change is scheduled, not here).
  async planStatus(input: PlanStatusInput): Promise<PlanStatusOutput> {
    const subscription = await this.prisma.subscription.findUnique({ where: { teamId: input.teamId } });
    if (!subscription) throw new NotFoundException("No subscription found for this team");

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const usagePeriod = await this.prisma.usagePeriod.findUnique({
      where: { teamId_periodStart: { teamId: input.teamId, periodStart } },
    });

    return {
      teamId: input.teamId,
      tier: subscription.tier,
      monthlyFeeEur: Number(subscription.monthlyFeeEur),
      conversationsIncluded: subscription.conversationsIncluded,
      conversationsUsedThisPeriod: usagePeriod?.conversationsUsed ?? 0,
      periodEnd: periodEnd.toISOString(),
      usageAlertThresholdPct: subscription.usageAlertThresholdPct,
      pendingPlanChange: subscription.pendingChangeEffectiveAt
        ? {
            effectiveAt: subscription.pendingChangeEffectiveAt.toISOString(),
            newMonthlyFeeEur: Number(subscription.pendingChangeFeeEur),
            notifiedAt: (subscription.pendingChangeNotifiedAt ?? new Date()).toISOString(),
          }
        : null,
    };
  }
}
