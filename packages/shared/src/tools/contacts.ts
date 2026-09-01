import { z } from "zod";

// Every business action is defined once here as a "tool": a name + input/output
// zod schema. Controllers and (later) the MCP server both bind to the same
// tool definition, so no action ever exists only as a UI button (product
// constraint: every feature must be a cleanly exposed tool).

export const ImportContactsInput = z.object({
  teamId: z.string().uuid(),
  source: z.enum(["CSV", "GOOGLE_SHEETS"]),
  rows: z
    .array(
      z.object({
        phoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/, "phone must be E.164"),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.string().email().optional(),
        tags: z.array(z.string()).default([]),
      }),
    )
    .min(1),
});
export type ImportContactsInput = z.infer<typeof ImportContactsInput>;

export const ImportContactsOutput = z.object({
  imported: z.number().int(),
  skippedDuplicates: z.number().int(),
  invalidRows: z.array(z.object({ row: z.number().int(), reason: z.string() })),
});
export type ImportContactsOutput = z.infer<typeof ImportContactsOutput>;

export const TagContactsInput = z.object({
  teamId: z.string().uuid(),
  contactIds: z.array(z.string().uuid()).min(1),
  addTags: z.array(z.string()).default([]),
  removeTags: z.array(z.string()).default([]),
});
export type TagContactsInput = z.infer<typeof TagContactsInput>;

export const CreateSegmentInput = z.object({
  teamId: z.string().uuid(),
  name: z.string().min(1),
  // MVP segmentation: tag-based only, expressed as an inspectable rule (no black box).
  matchTags: z.array(z.string()).min(1),
  matchMode: z.enum(["ANY", "ALL"]).default("ANY"),
});
export type CreateSegmentInput = z.infer<typeof CreateSegmentInput>;

export const SegmentOutput = z.object({
  id: z.string().uuid(),
  name: z.string(),
  matchTags: z.array(z.string()),
  matchMode: z.enum(["ANY", "ALL"]),
  contactCount: z.number().int(),
});
export type SegmentOutput = z.infer<typeof SegmentOutput>;

export const ListSegmentsInput = z.object({ teamId: z.string().uuid() });
export type ListSegmentsInput = z.infer<typeof ListSegmentsInput>;

export const CONTACTS_TOOLS = {
  "contacts.import": { input: ImportContactsInput, output: ImportContactsOutput },
  "contacts.tag": { input: TagContactsInput, output: z.object({ updated: z.number().int() }) },
  "contacts.createSegment": { input: CreateSegmentInput, output: SegmentOutput },
  "contacts.listSegments": { input: ListSegmentsInput, output: z.array(SegmentOutput) },
} as const;
