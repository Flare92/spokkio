import { Injectable } from "@nestjs/common";
import type { CreateTemplateInput, TemplateOutput, ListTemplatesInput } from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  // Tool: templates.create
  // Submits the template locally as PENDING_REVIEW; actual submission to
  // Meta for approval, and the resulting APPROVED/REJECTED webhook, is
  // handled by WebhookIngestService (see whatsapp/webhook-ingest.service.ts).
  async createTemplate(input: CreateTemplateInput): Promise<TemplateOutput> {
    const template = await this.prisma.template.create({
      data: {
        teamId: input.teamId,
        name: input.name,
        category: input.category,
        language: input.language,
        bodyText: input.bodyText,
        variables: input.variables,
        status: "PENDING_REVIEW",
      },
    });

    return {
      id: template.id,
      name: template.name,
      category: template.category,
      status: template.status,
      language: template.language,
      bodyText: template.bodyText,
      rejectionReason: template.rejectionReason,
    };
  }

  // Tool: templates.list
  async listTemplates(input: ListTemplatesInput): Promise<TemplateOutput[]> {
    const templates = await this.prisma.template.findMany({
      where: { teamId: input.teamId },
      orderBy: { createdAt: "desc" },
    });
    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      status: t.status,
      language: t.language,
      bodyText: t.bodyText,
      rejectionReason: t.rejectionReason,
    }));
  }
}
