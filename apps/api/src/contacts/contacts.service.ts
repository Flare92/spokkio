import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  ImportContactsInput,
  ImportContactsOutput,
  TagContactsInput,
  CreateSegmentInput,
  SegmentOutput,
  ListContactsInput,
  ListContactsOutput,
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
            customFields: row.customFields,
          },
        });
        imported++;
      } catch (err) {
        invalidRows.push({ row: index, reason: err instanceof Error ? err.message : "unknown error" });
      }
    }

    return { imported, updated, skippedDuplicates, invalidRows };
  }

  // Tool: contacts.list
  async listContacts(input: ListContactsInput): Promise<ListContactsOutput> {
    const where = {
      teamId: input.teamId,
      ...(input.tag ? { tags: { has: input.tag } } : {}),
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
        select: { tags: true, customFields: true },
      }),
    ]);

    const customFieldKeys = new Set<string>();
    const tagValues = new Set<string>();
    for (const c of allForFacets) {
      for (const t of c.tags) tagValues.add(t);
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
        customFields: (c.customFields as Record<string, string>) ?? {},
        createdAt: c.createdAt.toISOString(),
      })),
      total,
      availableCustomFields: Array.from(customFieldKeys).sort(),
      availableTags: Array.from(tagValues).sort(),
    };
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
  // Segmentation stays a plainly inspectable rule (tag match), never a black
  // box — anyone on the team can see exactly why a contact is in a segment.
  async createSegment(input: CreateSegmentInput): Promise<SegmentOutput> {
    const matchingContacts = await this.findContactsMatchingTags(
      input.teamId,
      input.matchTags,
      input.matchMode,
    );

    const segment = await this.prisma.segment.create({
      data: {
        teamId: input.teamId,
        name: input.name,
        matchTags: input.matchTags,
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
      matchMode: segment.matchMode as "ANY" | "ALL",
      contactCount: matchingContacts.length,
    };
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
      matchMode: s.matchMode as "ANY" | "ALL",
      contactCount: s.contacts.length,
    }));
  }

  async getSegmentOrThrow(teamId: string, segmentId: string) {
    const segment = await this.prisma.segment.findFirst({ where: { id: segmentId, teamId } });
    if (!segment) throw new NotFoundException("Segment not found");
    return segment;
  }

  private async findContactsMatchingTags(teamId: string, tags: string[], mode: "ANY" | "ALL") {
    const contacts = await this.prisma.contact.findMany({ where: { teamId } });
    return contacts.filter((c) =>
      mode === "ANY" ? tags.some((t) => c.tags.includes(t)) : tags.every((t) => c.tags.includes(t)),
    );
  }
}
