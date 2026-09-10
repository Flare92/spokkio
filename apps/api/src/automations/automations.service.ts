import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateAutomationInput,
  AutomationOutput,
  ListAutomationsInput,
  UpdateAutomationInput,
  DeleteAutomationInput,
} from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AutomationsService {
  constructor(private readonly prisma: PrismaService) {}

  // Tool: automations.create — beyond the 3 fixed Fase 1 triggers, the user
  // can now create as many named automations as they want per trigger type,
  // each with its own template and audience conditions.
  async createAutomation(input: CreateAutomationInput): Promise<AutomationOutput> {
    const automation = await this.prisma.automation.create({
      data: {
        teamId: input.teamId,
        name: input.name ?? null,
        triggerType: input.triggerType,
        templateId: input.templateId,
        offsetMinutes: input.offsetMinutes,
        matchCategories: input.matchCategories,
        matchTags: input.matchTags,
        enabled: input.enabled,
      },
      include: { template: true },
    });

    return this.toOutput(automation);
  }

  // Tool: automations.list
  async listAutomations(input: ListAutomationsInput): Promise<AutomationOutput[]> {
    const automations = await this.prisma.automation.findMany({
      where: { teamId: input.teamId },
      include: { template: true },
      orderBy: { createdAt: "desc" },
    });
    return automations.map((a) => this.toOutput(a));
  }

  // Tool: automations.update — enable/disable, retarget, or retune an
  // existing automation without losing its run history.
  async updateAutomation(input: UpdateAutomationInput): Promise<AutomationOutput> {
    const existing = await this.prisma.automation.findFirst({
      where: { id: input.automationId, teamId: input.teamId },
    });
    if (!existing) throw new NotFoundException("Automation not found");

    const automation = await this.prisma.automation.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
        ...(input.offsetMinutes !== undefined ? { offsetMinutes: input.offsetMinutes } : {}),
        ...(input.matchCategories !== undefined ? { matchCategories: input.matchCategories } : {}),
        ...(input.matchTags !== undefined ? { matchTags: input.matchTags } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
      include: { template: true },
    });

    return this.toOutput(automation);
  }

  // Tool: automations.delete
  async deleteAutomation(input: DeleteAutomationInput): Promise<{ deleted: true }> {
    const existing = await this.prisma.automation.findFirst({
      where: { id: input.automationId, teamId: input.teamId },
    });
    if (!existing) throw new NotFoundException("Automation not found");

    await this.prisma.automationRun.deleteMany({ where: { automationId: existing.id } });
    await this.prisma.automation.delete({ where: { id: existing.id } });
    return { deleted: true };
  }

  private toOutput(automation: {
    id: string;
    name: string | null;
    triggerType: string;
    templateId: string;
    offsetMinutes: number;
    matchCategories: string[];
    matchTags: string[];
    enabled: boolean;
    createdAt: Date;
    template: { name: string };
  }): AutomationOutput {
    return {
      id: automation.id,
      name: automation.name,
      triggerType: automation.triggerType as AutomationOutput["triggerType"],
      templateId: automation.templateId,
      templateName: automation.template.name,
      offsetMinutes: automation.offsetMinutes,
      matchCategories: automation.matchCategories,
      matchTags: automation.matchTags,
      enabled: automation.enabled,
      createdAt: automation.createdAt.toISOString(),
    };
  }
}
