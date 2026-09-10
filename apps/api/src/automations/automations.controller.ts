import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import {
  CreateAutomationInput,
  ListAutomationsInput,
  UpdateAutomationInput,
  DeleteAutomationInput,
} from "@spokkio/shared";
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

  // tool: automations.list
  @Post("list")
  list(@Body(new ZodValidationPipe(ListAutomationsInput)) body: ListAutomationsInput) {
    return this.automations.listAutomations(body);
  }

  // tool: automations.update
  @Post("update")
  update(@Body(new ZodValidationPipe(UpdateAutomationInput)) body: UpdateAutomationInput) {
    return this.automations.updateAutomation(body);
  }

  // tool: automations.delete
  @Post("delete")
  remove(@Body(new ZodValidationPipe(DeleteAutomationInput)) body: DeleteAutomationInput) {
    return this.automations.deleteAutomation(body);
  }
}
