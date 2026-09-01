import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { CampaignStatsInput, CampaignEventDrilldownInput } from "@spokkio/shared";
import { AnalyticsService } from "./analytics.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TeamScopeGuard } from "../auth/team-scope.guard";

@UseGuards(JwtAuthGuard, TeamScopeGuard)
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  // tool: analytics.campaignStats
  @Post("campaign-stats")
  campaignStats(@Body(new ZodValidationPipe(CampaignStatsInput)) body: CampaignStatsInput) {
    return this.analytics.campaignStats(body);
  }

  // tool: analytics.campaignEventDrilldown
  @Post("campaign-event-drilldown")
  drilldown(@Body(new ZodValidationPipe(CampaignEventDrilldownInput)) body: CampaignEventDrilldownInput) {
    return this.analytics.campaignEventDrilldown(body);
  }
}
