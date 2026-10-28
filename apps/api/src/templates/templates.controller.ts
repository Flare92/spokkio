import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import {
  CreateTemplateInput,
  ListTemplatesInput,
  SubmitTemplateInput,
  SyncTemplateStatusInput,
  UpdateTemplateInput,
  DeleteTemplateInput,
} from "@spokkio/shared";
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

  // tool: templates.submit
  @Post("submit")
  submit(@Body(new ZodValidationPipe(SubmitTemplateInput)) body: SubmitTemplateInput) {
    return this.templates.submitTemplate(body);
  }

  // tool: templates.syncStatus
  @Post("sync-status")
  syncStatus(@Body(new ZodValidationPipe(SyncTemplateStatusInput)) body: SyncTemplateStatusInput) {
    return this.templates.syncStatus(body);
  }

  // tool: templates.update
  @Post("update")
  update(@Body(new ZodValidationPipe(UpdateTemplateInput)) body: UpdateTemplateInput) {
    return this.templates.updateTemplate(body);
  }

  // tool: templates.delete
  @Post("delete")
  delete(@Body(new ZodValidationPipe(DeleteTemplateInput)) body: DeleteTemplateInput) {
    return this.templates.deleteTemplate(body);
  }
}
