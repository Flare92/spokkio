import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppService } from "../whatsapp/whatsapp.service";

const EVAL_WINDOW_MINUTES = 5; // must match the cron interval below

// Evaluates the three Fase 1 ready-to-use triggers every 5 minutes and fires
// due messages exactly once each (AutomationRun is the idempotency guard).
// This is deliberately a fixed-rule scheduler, not the general condition
// builder promised for Fase 2.
@Injectable()
export class AutomationsSchedulerService {
  private readonly logger = new Logger(AutomationsSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async evaluateDueAutomations() {
    const automations = await this.prisma.automation.findMany({
      where: { enabled: true },
      include: { template: true },
    });

    for (const automation of automations) {
      try {
        if (automation.triggerType === "APPOINTMENT_REMINDER") {
          await this.evaluateAppointmentReminder(automation as any);
        } else if (automation.triggerType === "POST_VISIT_FOLLOWUP") {
          await this.evaluatePostVisitFollowup(automation as any);
        } else if (automation.triggerType === "INACTIVE_CUSTOMER_WINBACK") {
          await this.evaluateInactiveWinback(automation as any);
        }
      } catch (err) {
        this.logger.error(`Automation ${automation.id} evaluation failed`, err as Error);
      }
    }
  }

  // offsetMinutes is negative: fires |offsetMinutes| before the appointment.
  private async evaluateAppointmentReminder(automation: AutomationWithTemplate) {
    const now = new Date();
    const windowStart = this.addMinutes(now, -automation.offsetMinutes - EVAL_WINDOW_MINUTES);
    const windowEnd = this.addMinutes(now, -automation.offsetMinutes);

    const dueAppointments = await this.prisma.appointment.findMany({
      where: { teamId: automation.teamId, status: "SCHEDULED", startsAt: { gte: windowStart, lt: windowEnd } },
      include: { contact: true },
    });

    for (const appointment of dueAppointments) {
      await this.fireOnce(automation, appointment.contactId, appointment.id, appointment.contact.phoneE164);
    }
  }

  // offsetMinutes is positive: fires that many minutes after the visit.
  private async evaluatePostVisitFollowup(automation: AutomationWithTemplate) {
    const now = new Date();
    const windowStart = this.addMinutes(now, -automation.offsetMinutes - EVAL_WINDOW_MINUTES);
    const windowEnd = this.addMinutes(now, -automation.offsetMinutes);

    const completedAppointments = await this.prisma.appointment.findMany({
      where: { teamId: automation.teamId, status: "COMPLETED", startsAt: { gte: windowStart, lt: windowEnd } },
      include: { contact: true },
    });

    for (const appointment of completedAppointments) {
      await this.fireOnce(automation, appointment.contactId, appointment.id, appointment.contact.phoneE164);
    }
  }

  // offsetMinutes is positive: fires when a contact has been inactive that
  // long (e.g. "chi non prenota da 60 giorni" -> offsetMinutes = 60*24*60).
  private async evaluateInactiveWinback(automation: AutomationWithTemplate) {
    const now = new Date();
    const windowStart = this.addMinutes(now, -automation.offsetMinutes - EVAL_WINDOW_MINUTES);
    const windowEnd = this.addMinutes(now, -automation.offsetMinutes);

    const inactiveContacts = await this.prisma.contact.findMany({
      where: { teamId: automation.teamId, lastActivityAt: { gte: windowStart, lt: windowEnd } },
    });

    for (const contact of inactiveContacts) {
      // referenceId reuses contactId since there's no per-cycle event id for winback.
      await this.fireOnce(automation, contact.id, contact.id, contact.phoneE164);
    }
  }

  private async fireOnce(
    automation: AutomationWithTemplate,
    contactId: string,
    referenceId: string,
    toE164: string,
  ) {
    const alreadyRun = await this.prisma.automationRun.findUnique({
      where: { automationId_referenceId: { automationId: automation.id, referenceId } },
    });
    if (alreadyRun) return;

    const waConnection = await this.prisma.whatsAppConnection.findUnique({
      where: { teamId: automation.teamId },
    });
    if (!waConnection) {
      this.logger.warn(`Automation ${automation.id} skipped: no WhatsApp connection for team`);
      return;
    }

    let conversation = await this.prisma.conversation.findFirst({ where: { contactId, closedAt: null } });
    if (!conversation) {
      conversation = await this.prisma.conversation.create({ data: { teamId: automation.teamId, contactId } });
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        category: automation.template.category,
        text: automation.template.bodyText,
        status: "QUEUED",
      },
    });

    try {
      const result = await this.whatsapp.sendTemplateMessage({
        phoneNumberId: waConnection.phoneNumberId,
        accessToken: waConnection.accessTokenEncrypted,
        toE164,
        templateName: automation.template.name,
        language: automation.template.language,
        variables: [],
        category: automation.template.category,
      });
      await this.prisma.message.update({
        where: { id: message.id },
        data: { waMessageId: result.waMessageId, status: "SENT" },
      });
    } catch (err) {
      await this.prisma.message.update({
        where: { id: message.id },
        data: { status: "FAILED", failedReason: err instanceof Error ? err.message : "unknown error" },
      });
    } finally {
      // Recorded even on send failure so a persistently-failing send doesn't
      // retry every 5 minutes forever; delivery failures surface in analytics instead.
      await this.prisma.automationRun.create({
        data: { automationId: automation.id, contactId, referenceId },
      });
    }
  }

  private addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60_000);
  }
}

interface AutomationWithTemplate {
  id: string;
  teamId: string;
  triggerType: string;
  offsetMinutes: number;
  template: { name: string; language: string; category: any; bodyText: string };
}
