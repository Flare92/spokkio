import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { CreateAutomationInput } from "@spokkio/shared";
import { AutomationsService } from "./automations.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TeamScopeGuard } from "../auth/team-scope.guard";

@UseGuards(JwtAuthGuard, TeamScopeGuard)
@Controller("automations")
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  // tool: automations.create
  @Post()
  create(@Body(new ZodValidationPipe(CreateAutomationInput)) body: CreateAutomationInput) {
    return this.automations.createAutomation(body);
  }
}
