import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateTemplateInput,
  TemplateOutput,
  ListTemplatesInput,
  SubmitTemplateInput,
} from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppService } from "../whatsapp/whatsapp.service";

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  // Tool: templates.create
  // Crea solo il record locale in PENDING_REVIEW; la sottomissione reale a
  // Meta è un passo esplicito separato (templates.submit), così l'utente può
  // ancora correggere testo/categoria prima di consumare un tentativo di
  // revisione.
  async createTemplate(input: CreateTemplateInput): Promise<TemplateOutput> {
    const template = await this.prisma.template.create({
      data: {
        teamId: input.teamId,
        name: normalizeTemplateName(input.name),
        category: input.category,
        language: input.language,
        bodyText: input.bodyText,
        variables: input.variables,
        status: "PENDING_REVIEW",
      },
    });

    return this.toOutput(template);
  }

  // Tool: templates.submit
  async submitTemplate(input: SubmitTemplateInput): Promise<TemplateOutput> {
    const template = await this.prisma.template.findFirst({
      where: { id: input.templateId, teamId: input.teamId },
    });
    if (!template) throw new NotFoundException("Template not found");

    const connection = await this.prisma.whatsAppConnection.findUnique({ where: { teamId: input.teamId } });
    if (!connection) {
      throw new BadRequestException("Collega prima un numero WhatsApp dalle Impostazioni");
    }

    const result = await this.whatsapp.submitTemplate({
      wabaId: connection.wabaId,
      accessToken: connection.accessTokenEncrypted,
      name: template.name,
      category: template.category,
      language: template.language,
      bodyText: template.bodyText,
    });

    const updated = await this.prisma.template.update({
      where: { id: template.id },
      data:
        "metaTemplateId" in result
          ? { metaTemplateId: result.metaTemplateId, submissionError: null }
          : { submissionError: result.error },
    });

    return this.toOutput(updated);
  }

  // Tool: templates.list
  async listTemplates(input: ListTemplatesInput): Promise<TemplateOutput[]> {
    const templates = await this.prisma.template.findMany({
      where: { teamId: input.teamId },
      orderBy: { createdAt: "desc" },
    });
    return templates.map((t) => this.toOutput(t));
  }

  private toOutput(t: {
    id: string;
    name: string;
    category: string;
    status: string;
    language: string;
    bodyText: string;
    rejectionReason: string | null;
    metaTemplateId: string | null;
    submissionError: string | null;
  }): TemplateOutput {
    return {
      id: t.id,
      name: t.name,
      category: t.category as TemplateOutput["category"],
      status: t.status as TemplateOutput["status"],
      language: t.language,
      bodyText: t.bodyText,
      rejectionReason: t.rejectionReason,
      metaTemplateId: t.metaTemplateId,
      submissionError: t.submissionError,
    };
  }
}

// Meta accetta solo minuscolo, numeri e underscore nel nome del template.
function normalizeTemplateName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}
