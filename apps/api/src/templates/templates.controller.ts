import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { CreateTemplateInput, ListTemplatesInput } from "@spokkio/shared";
import { TemplatesService } from "./templates.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TeamScopeGuard } from "../auth/team-scope.guard";

@UseGuards(JwtAuthGuard, TeamScopeGuard)
@Controller("templates")
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  // tool: templates.create
  @Post()
  create(@Body(new ZodValidationPipe(CreateTemplateInput)) body: CreateTemplateInput) {
    return this.templates.createTemplate(body);
  }

  // tool: templates.list
  @Post("list")
  list(@Body(new ZodValidationPipe(ListTemplatesInput)) body: ListTemplatesInput) {
    return this.templates.listTemplates(body);
  }
}
