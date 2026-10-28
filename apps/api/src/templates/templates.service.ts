import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateTemplateInput,
  TemplateOutput,
  ListTemplatesInput,
  SubmitTemplateInput,
  SyncTemplateStatusInput,
  UpdateTemplateInput,
  DeleteTemplateInput,
} from "@spokkio/shared";
import { findTemplateProblems } from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppService } from "../whatsapp/whatsapp.service";
import { MediaService } from "../media/media.service";

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly media: MediaService,
  ) {}

  // Tool: templates.create
  // Crea solo il record locale come bozza; la sottomissione reale a
  // Meta è un passo esplicito separato (templates.submit), così l'utente può
  // ancora correggere testo/categoria prima di consumare un tentativo di
  // revisione.
  async createTemplate(input: CreateTemplateInput): Promise<TemplateOutput> {
    if (input.headerImageId) await this.media.assertBelongsToTeam(input.teamId, input.headerImageId);
    const template = await this.prisma.template.create({
      data: {
        teamId: input.teamId,
        name: normalizeTemplateName(input.name),
        category: input.category,
        language: input.language,
        bodyText: input.bodyText,
        variables: input.variables,
        headerImageId: input.headerImageId ?? null,
        status: "DRAFT",
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

    if (template.status === "APPROVED" || (template.status === "PENDING_REVIEW" && template.metaTemplateId)) {
      throw new BadRequestException("Questo template è già approvato o in revisione su Meta");
    }

    // Gli errori di formato più comuni si controllano qui: niente tentativo
    // sprecato e un messaggio in italiano al posto di quello generico di Meta.
    const problems = findTemplateProblems({ name: template.name, bodyText: template.bodyText });
    if (problems.length > 0) {
      const failed = await this.prisma.template.update({
        where: { id: template.id },
        data: { submissionError: `Da correggere prima dell'invio: ${problems.join(" ")}` },
      });
      return this.toOutput(failed);
    }

    const connection = await this.prisma.whatsAppConnection.findUnique({ where: { teamId: input.teamId } });
    if (!connection) {
      throw new BadRequestException("Collega prima un numero WhatsApp dalle Impostazioni");
    }

    let headerImageHandle: string | undefined;
    if (template.headerImageId) {
      const image = await this.media.getData(template.headerImageId);
      const uploaded = await this.whatsapp.uploadTemplateExampleImage({
        accessToken: connection.accessTokenEncrypted,
        data: image.data,
        mimeType: image.mimeType,
      });
      if ("error" in uploaded) {
        const failed = await this.prisma.template.update({
          where: { id: template.id },
          data: { submissionError: `Caricamento immagine di esempio: ${uploaded.error}` },
        });
        return this.toOutput(failed);
      }
      headerImageHandle = uploaded.handle;
    }

    const result = await this.whatsapp.submitTemplate({
      wabaId: connection.wabaId,
      accessToken: connection.accessTokenEncrypted,
      name: template.name,
      category: template.category,
      language: template.language,
      bodyText: template.bodyText,
      headerImageHandle,
      // Un template rifiutato si corregge e si rimanda con lo stesso id Meta.
      existingMetaTemplateId: template.status === "REJECTED" ? template.metaTemplateId ?? undefined : undefined,
    });

    const updated = await this.prisma.template.update({
      where: { id: template.id },
      data:
        "metaTemplateId" in result
          ? { metaTemplateId: result.metaTemplateId, submissionError: null, rejectionReason: null, status: "PENDING_REVIEW" }
          : { submissionError: result.error },
    });

    return this.toOutput(updated);
  }

  // Tool: templates.syncStatus
  async syncStatus(input: SyncTemplateStatusInput): Promise<TemplateOutput> {
    const template = await this.prisma.template.findFirst({
      where: { id: input.templateId, teamId: input.teamId },
    });
    if (!template) throw new NotFoundException("Template not found");
    if (!template.metaTemplateId) throw new BadRequestException("Il template non è ancora stato sottomesso a Meta");

    const connection = await this.prisma.whatsAppConnection.findUnique({ where: { teamId: input.teamId } });
    if (!connection) throw new BadRequestException("Collega prima un numero WhatsApp dalle Impostazioni");

    const result = await this.whatsapp.getTemplateStatus({
      metaTemplateId: template.metaTemplateId,
      accessToken: connection.accessTokenEncrypted,
    });
    if ("error" in result) throw new BadRequestException(`Meta non ha risposto: ${result.error}`);

    // PAUSED/DISABLED: Meta ha bloccato il template (di solito per segnalazioni
    // degli utenti) — non è utilizzabile, quindi lo trattiamo come rifiutato.
    const blocked = result.status === "PAUSED" || result.status === "DISABLED";
    const updated = await this.prisma.template.update({
      where: { id: template.id },
      data: {
        status:
          result.status === "APPROVED" ? "APPROVED" : result.status === "REJECTED" || blocked ? "REJECTED" : "PENDING_REVIEW",
        rejectionReason: blocked ? `Template ${result.status === "PAUSED" ? "in pausa" : "disattivato"} da Meta` : result.rejectedReason,
      },
    });
    return this.toOutput(updated);
  }

  // Tool: templates.update — solo per template non approvati e non in
  // revisione: dopo la modifica va risottomesso. Cambiare il nome di un
  // template già creato su Meta lo trasforma in un template nuovo (Meta non
  // permette di rinominare), quindi si perde il collegamento con il vecchio.
  async updateTemplate(input: UpdateTemplateInput): Promise<TemplateOutput> {
    const template = await this.prisma.template.findFirst({
      where: { id: input.templateId, teamId: input.teamId },
    });
    if (!template) throw new NotFoundException("Template not found");
    if (template.status === "APPROVED") {
      throw new BadRequestException("Un template approvato non si modifica: duplicalo con un nome nuovo");
    }
    if (template.status === "PENDING_REVIEW" && template.metaTemplateId) {
      throw new BadRequestException("Il template è in revisione su Meta: aspetta l'esito prima di modificarlo");
    }
    if (input.headerImageId) await this.media.assertBelongsToTeam(input.teamId, input.headerImageId);

    const name = normalizeTemplateName(input.name);
    const renamedOnMeta = template.metaTemplateId !== null && (name !== template.name || input.language !== template.language);

    const updated = await this.prisma.template.update({
      where: { id: template.id },
      data: {
        name,
        category: input.category,
        language: input.language,
        bodyText: input.bodyText,
        headerImageId: input.headerImageId === undefined ? template.headerImageId : input.headerImageId,
        submissionError: null,
        ...(renamedOnMeta ? { metaTemplateId: null, rejectionReason: null, status: "DRAFT" as const } : {}),
      },
    });
    return this.toOutput(updated);
  }

  // Tool: templates.delete — non se una campagna o un'automazione lo usa.
  async deleteTemplate(input: DeleteTemplateInput): Promise<{ deleted: true }> {
    const template = await this.prisma.template.findFirst({
      where: { id: input.templateId, teamId: input.teamId },
      include: { _count: { select: { campaigns: true, variantBCampaigns: true, automations: true } } },
    });
    if (!template) throw new NotFoundException("Template not found");
    const uses = template._count.campaigns + template._count.variantBCampaigns + template._count.automations;
    if (uses > 0) {
      throw new BadRequestException(
        `Il template è usato da ${uses} campagne o automazioni: eliminale o cambia template prima di cancellarlo`,
      );
    }

    if (template.metaTemplateId) {
      const connection = await this.prisma.whatsAppConnection.findUnique({ where: { teamId: input.teamId } });
      if (connection) {
        await this.whatsapp.deleteTemplate({
          wabaId: connection.wabaId,
          accessToken: connection.accessTokenEncrypted,
          name: template.name,
          metaTemplateId: template.metaTemplateId,
        });
      }
    }
    await this.prisma.template.delete({ where: { id: template.id } });
    return { deleted: true };
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
    headerImageId: string | null;
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
      headerImageId: t.headerImageId,
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
