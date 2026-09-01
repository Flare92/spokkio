import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { PlanStatusInput } from "@spokkio/shared";
import { BillingService } from "./billing.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TeamScopeGuard } from "../auth/team-scope.guard";

@UseGuards(JwtAuthGuard, TeamScopeGuard)
@Controller("billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // tool: billing.planStatus
  @Post("plan-status")
  planStatus(@Body(new ZodValidationPipe(PlanStatusInput)) body: PlanStatusInput) {
    return this.billing.planStatus(body);
  }
}
