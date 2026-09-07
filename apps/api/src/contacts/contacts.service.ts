import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  ImportContactsInput,
  ImportContactsOutput,
  TagContactsInput,
  AssignCategoriesInput,
  CreateSegmentInput,
  SegmentOutput,
  ListContactsInput,
  ListContactsOutput,
  EnsureCategorySegmentInput,
} from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  // Tool: contacts.import
  async importContacts(input: ImportContactsInput): Promise<ImportContactsOutput> {
    let imported = 0;
    let updated = 0;
    let skippedDuplicates = 0;
    const invalidRows: { row: number; reason: string }[] = [];

    for (const [index, row] of input.rows.entries()) {
      try {
        const existing = await this.prisma.contact.findUnique({
          where: { teamId_phoneE164: { teamId: input.teamId, phoneE164: row.phoneE164 } },
        });

        if (existing) {
          if (!input.updateExisting) {
            skippedDuplicates++;
            continue;
          }
          // I campi custom vengono fusi con quelli già presenti, così un file
          // che porta solo alcune colonne non cancella le altre.
          const mergedCustomFields = {
            ...((existing.customFields as Record<string, string>) ?? {}),
            ...row.customFields,
          };
          await this.prisma.contact.update({
            where: { id: existing.id },
            data: {
              firstName: row.firstName ?? existing.firstName,
              lastName: row.lastName ?? existing.lastName,
              email: row.email ?? existing.email,
              tags: Array.from(new Set([...existing.tags, ...row.tags])),
              categories: Array.from(new Set([...existing.categories, ...row.categories])),
              customFields: mergedCustomFields,
            },
          });
          updated++;
          continue;
        }

        await this.prisma.contact.create({
          data: {
            teamId: input.teamId,
            phoneE164: row.phoneE164,
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            tags: row.tags,
            categories: row.categories,
            customFields: row.customFields,
          },
        });
        imported++;
      } catch (err) {
        invalidRows.push({ row: index, reason: err instanceof Error ? err.message : "unknown error" });
      }
    }

    // Un import porta contatti nuovi dentro categorie esistenti: i segmenti
    // basati su categoria vanno riallineati, altrimenti i nuovi arrivati non
    // risulterebbero destinatari finché non si tocca qualcos'altro.
    await this.refreshCategorySegments(input.teamId);

    return { imported, updated, skippedDuplicates, invalidRows };
  }

  // Tool: contacts.list
  async listContacts(input: ListContactsInput): Promise<ListContactsOutput> {
    const where = {
      teamId: input.teamId,
      ...(input.tag ? { tags: { has: input.tag } } : {}),
      ...(input.category ? { categories: { has: input.category } } : {}),
      ...(input.search
        ? {
            OR: [
              { phoneE164: { contains: input.search, mode: "insensitive" as const } },
              { firstName: { contains: input.search, mode: "insensitive" as const } },
              { lastName: { contains: input.search, mode: "insensitive" as const } },
              { email: { contains: input.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [contacts, total, allForFacets] = await Promise.all([
      this.prisma.contact.findMany({ where, orderBy: { createdAt: "desc" }, take: input.limit }),
      this.prisma.contact.count({ where }),
      // Le liste di tag e campi custom disponibili si ricavano da tutti i
      // contatti del team, non solo da quelli filtrati: servono a costruire le
      // campagne, non a descrivere il filtro corrente.
      this.prisma.contact.findMany({
        where: { teamId: input.teamId },
        select: { tags: true, categories: true, customFields: true },
      }),
    ]);

    const customFieldKeys = new Set<string>();
    const tagValues = new Set<string>();
    const categoryCounts = new Map<string, number>();
    for (const c of allForFacets) {
      for (const t of c.tags) tagValues.add(t);
      for (const category of c.categories) {
        categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      }
      for (const key of Object.keys((c.customFields as Record<string, string>) ?? {})) {
        customFieldKeys.add(key);
      }
    }

    return {
      contacts: contacts.map((c) => ({
        id: c.id,
        phoneE164: c.phoneE164,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        tags: c.tags,
        categories: c.categories,
        customFields: (c.customFields as Record<string, string>) ?? {},
        createdAt: c.createdAt.toISOString(),
      })),
      total,
      availableCustomFields: Array.from(customFieldKeys).sort(),
      availableTags: Array.from(tagValues).sort(),
      availableCategories: Array.from(categoryCounts.entries())
        .map(([name, contactCount]) => ({ name, contactCount }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  // Tool: contacts.assignCategories
  async assignCategories(input: AssignCategoriesInput): Promise<{ updated: number }> {
    let updated = 0;
    for (const contactId of input.contactIds) {
      const contact = await this.prisma.contact.findFirst({
        where: { id: contactId, teamId: input.teamId },
      });
      if (!contact) continue;

      const next = new Set(contact.categories);
      for (const c of input.addCategories) next.add(c);
      for (const c of input.removeCategories) next.delete(c);

      await this.prisma.contact.update({
        where: { id: contactId },
        data: { categories: Array.from(next) },
      });
      updated++;
    }

    // I segmenti sono fotografie della loro regola: se cambiano le categorie
    // dei contatti, quelli basati su categoria vanno riallineati subito,
    // altrimenti una campagna partirebbe verso un elenco ormai vecchio.
    await this.refreshCategorySegments(input.teamId);
    return { updated };
  }

  // Tool: contacts.tag
  async tagContacts(input: TagContactsInput): Promise<{ updated: number }> {
    let updated = 0;
    for (const contactId of input.contactIds) {
      const contact = await this.prisma.contact.findFirst({
        where: { id: contactId, teamId: input.teamId },
      });
      if (!contact) continue;

      const nextTags = new Set(contact.tags);
      for (const t of input.addTags) nextTags.add(t);
      for (const t of input.removeTags) nextTags.delete(t);

      await this.prisma.contact.update({
        where: { id: contactId },
        data: { tags: Array.from(nextTags) },
      });
      updated++;
    }
    return { updated };
  }

  // Tool: contacts.createSegment
  // Segmentation stays a plainly inspectable rule (tags and/or categories),
  // never a black box — anyone on the team can see exactly why a contact is
  // in a segment.
  async createSegment(input: CreateSegmentInput): Promise<SegmentOutput> {
    const matchingContacts = await this.findMatchingContacts(input.teamId, {
      matchTags: input.matchTags,
      matchCategories: input.matchCategories,
      matchMode: input.matchMode,
    });

    const segment = await this.prisma.segment.create({
      data: {
        teamId: input.teamId,
        name: input.name,
        matchTags: input.matchTags,
        matchCategories: input.matchCategories,
        matchMode: input.matchMode,
        contacts: {
          create: matchingContacts.map((c) => ({ contactId: c.id })),
        },
      },
    });

    return {
      id: segment.id,
      name: segment.name,
      matchTags: segment.matchTags,
      matchCategories: segment.matchCategories,
      matchMode: segment.matchMode as "ANY" | "ALL",
      contactCount: matchingContacts.length,
    };
  }

  // Tool: contacts.ensureCategorySegment
  async ensureCategorySegment(input: EnsureCategorySegmentInput): Promise<SegmentOutput> {
    const existing = await this.prisma.segment.findFirst({
      where: { teamId: input.teamId, matchCategories: { has: input.category }, matchTags: { isEmpty: true } },
    });

    if (existing) {
      const contactCount = await this.syncSegmentMembership(existing.id);
      return {
        id: existing.id,
        name: existing.name,
        matchTags: existing.matchTags,
        matchCategories: existing.matchCategories,
        matchMode: existing.matchMode as "ANY" | "ALL",
        contactCount,
      };
    }

    return this.createSegment({
      teamId: input.teamId,
      name: `Categoria: ${input.category}`,
      matchTags: [],
      matchCategories: [input.category],
      matchMode: "ANY",
    });
  }

  // Tool: contacts.listSegments
  async listSegments(input: { teamId: string }): Promise<SegmentOutput[]> {
    const segments = await this.prisma.segment.findMany({
      where: { teamId: input.teamId },
      include: { contacts: true },
      orderBy: { createdAt: "desc" },
    });
    return segments.map((s) => ({
      id: s.id,
      name: s.name,
      matchTags: s.matchTags,
      matchCategories: s.matchCategories,
      matchMode: s.matchMode as "ANY" | "ALL",
      contactCount: s.contacts.length,
    }));
  }

  async getSegmentOrThrow(teamId: string, segmentId: string) {
    const segment = await this.prisma.segment.findFirst({ where: { id: segmentId, teamId } });
    if (!segment) throw new NotFoundException("Segment not found");
    return segment;
  }

  // Riallinea l'elenco materializzato di un segmento alla sua regola.
  private async syncSegmentMembership(segmentId: string): Promise<number> {
    const segment = await this.prisma.segment.findUnique({ where: { id: segmentId } });
    if (!segment) return 0;

    const matching = await this.findMatchingContacts(segment.teamId, {
      matchTags: segment.matchTags,
      matchCategories: segment.matchCategories,
      matchMode: segment.matchMode as "ANY" | "ALL",
    });

    await this.prisma.segmentContact.deleteMany({ where: { segmentId } });
    if (matching.length > 0) {
      await this.prisma.segmentContact.createMany({
        data: matching.map((c) => ({ segmentId, contactId: c.id })),
      });
    }
    return matching.length;
  }

  private async refreshCategorySegments(teamId: string): Promise<void> {
    const segments = await this.prisma.segment.findMany({
      where: { teamId, NOT: { matchCategories: { isEmpty: true } } },
      select: { id: true },
    });
    for (const segment of segments) {
      await this.syncSegmentMembership(segment.id);
    }
  }

  private async findMatchingContacts(
    teamId: string,
    rule: { matchTags: string[]; matchCategories: string[]; matchMode: "ANY" | "ALL" },
  ) {
    const contacts = await this.prisma.contact.findMany({ where: { teamId } });
    return contacts.filter((c) => {
      // Con entrambe le condizioni presenti il contatto deve soddisfarle
      // tutte e due: "categoria X, ma solo chi ha anche il tag Y".
      const tagsOk =
        rule.matchTags.length === 0
          ? true
          : rule.matchMode === "ANY"
            ? rule.matchTags.some((t) => c.tags.includes(t))
            : rule.matchTags.every((t) => c.tags.includes(t));

      const categoriesOk =
        rule.matchCategories.length === 0
          ? true
          : rule.matchCategories.some((category) => c.categories.includes(category));

      return tagsOk && categoriesOk;
    });
  }
}
