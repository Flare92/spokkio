import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import {
  CostEstimateInput,
  CreateCampaignInput,
  SendCampaignInput,
  ListCampaignsInput,
  PreviewCampaignInput,
  CancelScheduledCampaignInput,
  DuplicateCampaignInput,
  ABTestResultsInput,
} from "@spokkio/shared";
import { CampaignsService } from "./campaigns.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TeamScopeGuard } from "../auth/team-scope.guard";

@UseGuards(JwtAuthGuard, TeamScopeGuard)
@Controller("campaigns")
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  // tool: campaigns.estimateCost
  @Post("estimate-cost")
  estimateCost(@Body(new ZodValidationPipe(CostEstimateInput)) body: CostEstimateInput) {
    return this.campaigns.estimateCost(body);
  }

  // tool: campaigns.create
  @Post()
  create(@Body(new ZodValidationPipe(CreateCampaignInput)) body: CreateCampaignInput) {
    return this.campaigns.createCampaign(body);
  }

  // tool: campaigns.send
  @Post("send")
  send(@Body(new ZodValidationPipe(SendCampaignInput)) body: SendCampaignInput) {
    return this.campaigns.sendCampaign(body);
  }

  // tool: campaigns.list
  @Post("list")
  list(@Body(new ZodValidationPipe(ListCampaignsInput)) body: ListCampaignsInput) {
    return this.campaigns.listCampaigns(body);
  }

  // tool: campaigns.preview
  @Post("preview")
  preview(@Body(new ZodValidationPipe(PreviewCampaignInput)) body: PreviewCampaignInput) {
    return this.campaigns.previewCampaign(body);
  }

  // tool: campaigns.cancelScheduled
  @Post("cancel-scheduled")
  cancelScheduled(
    @Body(new ZodValidationPipe(CancelScheduledCampaignInput)) body: CancelScheduledCampaignInput,
  ) {
    return this.campaigns.cancelScheduled(body);
  }

  // tool: campaigns.duplicate
  @Post("duplicate")
  duplicate(@Body(new ZodValidationPipe(DuplicateCampaignInput)) body: DuplicateCampaignInput) {
    return this.campaigns.duplicateCampaign(body);
  }

  // tool: campaigns.abTestResults
  @Post("ab-test-results")
  abTestResults(@Body(new ZodValidationPipe(ABTestResultsInput)) body: ABTestResultsInput) {
    return this.campaigns.abTestResults(body);
  }
}
