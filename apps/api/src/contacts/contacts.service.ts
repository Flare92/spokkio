import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
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
  ContactOutput,
  GetContactInput,
  ContactDetailOutput,
  UpdateContactInput,
  FindDuplicateContactsInput,
  DuplicateGroup,
  MergeContactsInput,
  ExportContactsInput,
  ExportContactsOutput,
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

  // Tool: contacts.get — scheda contatto: dati, conversazioni e campagne
  // ricevute, più eventuali duplicati sospetti su questo stesso contatto.
  async getContactDetail(input: GetContactInput): Promise<ContactDetailOutput> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: input.contactId, teamId: input.teamId },
    });
    if (!contact) throw new NotFoundException("Contact not found");

    const [conversations, messages] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { contactId: contact.id },
        include: { messages: { orderBy: { createdAt: "desc" }, take: 1 }, _count: { select: { messages: true } } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.message.findMany({
        where: { conversation: { contactId: contact.id }, campaignId: { not: null } },
        include: { campaign: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const duplicates = await this.findDuplicatesFor(contact);

    return {
      contact: this.toContactOutput(contact),
      conversations: conversations.map((c) => ({
        id: c.id,
        lastMessagePreview: c.messages[0]?.text ?? "",
        lastMessageAt: (c.messages[0]?.createdAt ?? c.createdAt).toISOString(),
        messageCount: c._count.messages,
        closedAt: c.closedAt ? c.closedAt.toISOString() : null,
      })),
      campaigns: messages
        .filter((m) => m.campaign)
        .map((m) => ({
          campaignId: m.campaign!.id,
          name: m.campaign!.name,
          status: m.campaign!.status,
          sentAt: m.campaign!.sentAt ? m.campaign!.sentAt.toISOString() : null,
          messageStatus: m.status,
        })),
      possibleDuplicates: duplicates,
    };
  }

  // Tool: contacts.update
  async updateContact(input: UpdateContactInput): Promise<ContactOutput> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: input.contactId, teamId: input.teamId },
    });
    if (!contact) throw new NotFoundException("Contact not found");

    if (input.phoneE164 && input.phoneE164 !== contact.phoneE164) {
      const clash = await this.prisma.contact.findUnique({
        where: { teamId_phoneE164: { teamId: input.teamId, phoneE164: input.phoneE164 } },
      });
      if (clash) throw new BadRequestException("Un altro contatto ha già questo numero");
    }

    const updated = await this.prisma.contact.update({
      where: { id: contact.id },
      data: {
        phoneE164: input.phoneE164 ?? contact.phoneE164,
        firstName: input.firstName === undefined ? contact.firstName : input.firstName,
        lastName: input.lastName === undefined ? contact.lastName : input.lastName,
        email: input.email === undefined ? contact.email : input.email,
        tags: input.tags ?? contact.tags,
        categories: input.categories ?? contact.categories,
        customFields:
          input.customFields === undefined
            ? (contact.customFields as object)
            : { ...((contact.customFields as Record<string, string>) ?? {}), ...input.customFields },
      },
    });

    if (input.categories) await this.refreshCategorySegments(input.teamId);
    return this.toContactOutput(updated);
  }

  // Tool: contacts.findDuplicates — scansione esplicita su tutto il team:
  // stesso numero scritto in modo diverso, o stesso nome+cognome. Nessun
  // modello statistico, solo regole che si possono spiegare a schermo.
  async findDuplicates(input: FindDuplicateContactsInput): Promise<DuplicateGroup[]> {
    const contacts = await this.prisma.contact.findMany({ where: { teamId: input.teamId } });
    const groups: DuplicateGroup[] = [];

    const byNormalizedPhone = new Map<string, typeof contacts>();
    for (const c of contacts) {
      const key = normalizePhoneForDedup(c.phoneE164);
      byNormalizedPhone.set(key, [...(byNormalizedPhone.get(key) ?? []), c]);
    }
    for (const group of byNormalizedPhone.values()) {
      if (group.length > 1) groups.push({ reason: "SAME_NORMALIZED_PHONE", contacts: group.map((c) => this.toContactOutput(c)) });
    }

    const byName = new Map<string, typeof contacts>();
    for (const c of contacts) {
      if (!c.firstName && !c.lastName) continue;
      const key = `${(c.firstName ?? "").trim().toLowerCase()} ${(c.lastName ?? "").trim().toLowerCase()}`.trim();
      if (!key) continue;
      byName.set(key, [...(byName.get(key) ?? []), c]);
    }
    for (const group of byName.values()) {
      if (group.length > 1 && !groups.some((g) => g.reason === "SAME_NORMALIZED_PHONE" && sameSet(g.contacts, group))) {
        groups.push({ reason: "SAME_NAME", contacts: group.map((c) => this.toContactOutput(c)) });
      }
    }

    return groups;
  }

  // Tool: contacts.merge — fonde i contatti indicati dentro quello scelto
  // come principale: tag/categorie/campi custom si sommano, lo storico
  // conversazioni si sposta, i duplicati vengono cancellati.
  async mergeContacts(input: MergeContactsInput): Promise<ContactOutput> {
    const keep = await this.prisma.contact.findFirst({
      where: { id: input.keepContactId, teamId: input.teamId },
    });
    if (!keep) throw new NotFoundException("Contatto principale non trovato");

    const toMerge = await this.prisma.contact.findMany({
      where: { id: { in: input.mergeContactIds }, teamId: input.teamId },
    });

    let tags = new Set(keep.tags);
    let categories = new Set(keep.categories);
    let customFields = { ...((keep.customFields as Record<string, string>) ?? {}) };

    for (const c of toMerge) {
      for (const t of c.tags) tags.add(t);
      for (const cat of c.categories) categories.add(cat);
      customFields = { ...((c.customFields as Record<string, string>) ?? {}), ...customFields };

      await this.prisma.conversation.updateMany({ where: { contactId: c.id }, data: { contactId: keep.id } });
      await this.prisma.attributionEvent.updateMany({ where: { contactId: c.id }, data: { contactId: keep.id } });
      await this.prisma.appointment.updateMany({ where: { contactId: c.id }, data: { contactId: keep.id } });
      await this.prisma.segmentContact.deleteMany({ where: { contactId: c.id } });
      await this.prisma.contact.delete({ where: { id: c.id } });
    }

    const updated = await this.prisma.contact.update({
      where: { id: keep.id },
      data: { tags: Array.from(tags), categories: Array.from(categories), customFields },
    });

    await this.refreshCategorySegments(input.teamId);
    return this.toContactOutput(updated);
  }

  // Tool: contacts.export
  async exportContacts(input: ExportContactsInput): Promise<ExportContactsOutput> {
    let contactIds: string[] | undefined;
    let label = "tutti";

    if (input.segmentId) {
      const segment = await this.getSegmentOrThrow(input.teamId, input.segmentId);
      const members = await this.prisma.segmentContact.findMany({ where: { segmentId: segment.id } });
      contactIds = members.map((m) => m.contactId);
      label = segment.name;
    }

    const contacts = await this.prisma.contact.findMany({
      where: {
        teamId: input.teamId,
        ...(contactIds ? { id: { in: contactIds } } : {}),
        ...(input.category ? { categories: { has: input.category } } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    const customFieldKeys = Array.from(
      new Set(contacts.flatMap((c) => Object.keys((c.customFields as Record<string, string>) ?? {}))),
    );

    const header = ["telefono", "nome", "cognome", "email", "tag", "categorie", ...customFieldKeys];
    const rows = contacts.map((c) => {
      const custom = (c.customFields as Record<string, string>) ?? {};
      return [
        c.phoneE164,
        c.firstName ?? "",
        c.lastName ?? "",
        c.email ?? "",
        c.tags.join("|"),
        c.categories.join("|"),
        ...customFieldKeys.map((k) => custom[k] ?? ""),
      ];
    });

    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
    const safeLabel = label.replace(/[^a-z0-9]+/gi, "_").toLowerCase();

    return {
      csv,
      filename: `contatti_${safeLabel}_${new Date().toISOString().slice(0, 10)}.csv`,
      count: contacts.length,
    };
  }

  private async findDuplicatesFor(
    contact: { id: string; teamId: string; phoneE164: string; firstName: string | null; lastName: string | null },
  ) {
    if (!contact.firstName && !contact.lastName) {
      const others = await this.prisma.contact.findMany({
        where: {
          teamId: contact.teamId,
          id: { not: contact.id },
        },
      });
      const key = normalizePhoneForDedup(contact.phoneE164);
      return others
        .filter((o) => normalizePhoneForDedup(o.phoneE164) === key)
        .map((o) => ({
          id: o.id,
          phoneE164: o.phoneE164,
          name: [o.firstName, o.lastName].filter(Boolean).join(" ") || null,
          reason: "Stesso numero scritto in modo diverso",
        }));
    }

    const others = await this.prisma.contact.findMany({
      where: { teamId: contact.teamId, id: { not: contact.id } },
    });
    const phoneKey = normalizePhoneForDedup(contact.phoneE164);
    const nameKey = `${(contact.firstName ?? "").trim().toLowerCase()} ${(contact.lastName ?? "").trim().toLowerCase()}`.trim();

    return others
      .filter((o) => {
        const sameName =
          nameKey && `${(o.firstName ?? "").trim().toLowerCase()} ${(o.lastName ?? "").trim().toLowerCase()}`.trim() === nameKey;
        const samePhone = normalizePhoneForDedup(o.phoneE164) === phoneKey;
        return sameName || samePhone;
      })
      .map((o) => ({
        id: o.id,
        phoneE164: o.phoneE164,
        name: [o.firstName, o.lastName].filter(Boolean).join(" ") || null,
        reason: normalizePhoneForDedup(o.phoneE164) === phoneKey ? "Stesso numero scritto in modo diverso" : "Stesso nome",
      }));
  }

  private toContactOutput(c: {
    id: string;
    phoneE164: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    tags: string[];
    categories: string[];
    customFields: unknown;
    createdAt: Date;
  }): ContactOutput {
    return {
      id: c.id,
      phoneE164: c.phoneE164,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      tags: c.tags,
      categories: c.categories,
      customFields: (c.customFields as Record<string, string>) ?? {},
      createdAt: c.createdAt.toISOString(),
    };
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

// Riduce un numero ai soli ultimi 9 cifre significative: fa combaciare
// "+393331234567", "3331234567" e "0039 333 1234567" come lo stesso numero,
// senza dover indovinare il prefisso internazionale di partenza.
function normalizePhoneForDedup(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-9);
}

function sameSet(a: { id: string }[], b: { id: string }[]): boolean {
  if (a.length !== b.length) return false;
  const idsA = new Set(a.map((x) => x.id));
  return b.every((x) => idsA.has(x.id));
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
