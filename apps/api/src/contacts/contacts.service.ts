import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  ImportContactsInput,
  ImportContactsOutput,
  TagContactsInput,
  CreateSegmentInput,
  SegmentOutput,
} from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  // Tool: contacts.import
  async importContacts(input: ImportContactsInput): Promise<ImportContactsOutput> {
    let imported = 0;
    let skippedDuplicates = 0;
    const invalidRows: { row: number; reason: string }[] = [];

    for (const [index, row] of input.rows.entries()) {
      try {
        const existing = await this.prisma.contact.findUnique({
          where: { teamId_phoneE164: { teamId: input.teamId, phoneE164: row.phoneE164 } },
        });
        if (existing) {
          skippedDuplicates++;
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
          },
        });
        imported++;
      } catch (err) {
        invalidRows.push({ row: index, reason: err instanceof Error ? err.message : "unknown error" });
      }
    }

    return { imported, skippedDuplicates, invalidRows };
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
