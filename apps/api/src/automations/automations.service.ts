import { Injectable } from "@nestjs/common";
import type { CreateAutomationInput, AutomationOutput } from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AutomationsService {
  constructor(private readonly prisma: PrismaService) {}

  // Tool: automations.create — Fase 1 ships these as fixed, ready-to-use
  // triggers (not a free-form builder yet, see roadmap Fase 2).
  async createAutomation(input: CreateAutomationInput): Promise<AutomationOutput> {
    const automation = await this.prisma.automation.create({
      data: {
        teamId: input.teamId,
        triggerType: input.triggerType,
        templateId: input.templateId,
        offsetMinutes: input.offsetMinutes,
        enabled: input.enabled,
      },
    });

    return {
      id: automation.id,
      triggerType: automation.triggerType,
      templateId: automation.templateId,
      offsetMinutes: automation.offsetMinutes,
      enabled: automation.enabled,
    };
  }
}
