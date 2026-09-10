import { z } from "zod";

// Every business action is defined once here as a "tool": a name + input/output
// zod schema. Controllers and (later) the MCP server both bind to the same
// tool definition, so no action ever exists only as a UI button (product
// constraint: every feature must be a cleanly exposed tool).

export const ImportContactsInput = z.object({
  teamId: z.string().uuid(),
  source: z.enum(["CSV", "XLSX", "GOOGLE_SHEETS", "MANUAL"]),
  // Se true, un contatto già presente viene aggiornato con i dati della riga
  // invece di essere semplicemente saltato.
  updateExisting: z.boolean().default(false),
  rows: z
    .array(
      z.object({
        phoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/, "phone must be E.164"),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.string().email().optional(),
        tags: z.array(z.string()).default([]),
        // Raggruppamento proposto come destinatario quando si crea una
        // campagna: assegnabile per riga, su una selezione o su tutto il file.
        categories: z.array(z.string()).default([]),
        // Colonne extra del file, disponibili poi come variabili nei template.
        customFields: z.record(z.string()).default({}),
      }),
    )
    .min(1),
});
export type ImportContactsInput = z.infer<typeof ImportContactsInput>;

export const ImportContactsOutput = z.object({
  imported: z.number().int(),
  updated: z.number().int(),
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

// Assegna o toglie categorie a contatti già salvati: la stessa operazione
// serve sia dalla lista contatti sia dopo un import.
export const AssignCategoriesInput = z.object({
  teamId: z.string().uuid(),
  contactIds: z.array(z.string().uuid()).min(1),
  addCategories: z.array(z.string()).default([]),
  removeCategories: z.array(z.string()).default([]),
});
export type AssignCategoriesInput = z.infer<typeof AssignCategoriesInput>;

export const CreateSegmentInput = z
  .object({
    teamId: z.string().uuid(),
    name: z.string().min(1),
    // La selezione resta una regola leggibile, mai una scatola nera: per tag,
    // per categoria, o per entrambi (in quel caso valgono tutte e due).
    matchTags: z.array(z.string()).default([]),
    matchCategories: z.array(z.string()).default([]),
    matchMode: z.enum(["ANY", "ALL"]).default("ANY"),
  })
  .refine((v) => v.matchTags.length > 0 || v.matchCategories.length > 0, {
    message: "Serve almeno un tag o una categoria",
  });
export type CreateSegmentInput = z.infer<typeof CreateSegmentInput>;

export const SegmentOutput = z.object({
  id: z.string().uuid(),
  name: z.string(),
  matchTags: z.array(z.string()),
  matchCategories: z.array(z.string()),
  matchMode: z.enum(["ANY", "ALL"]),
  contactCount: z.number().int(),
});
export type SegmentOutput = z.infer<typeof SegmentOutput>;

export const ListSegmentsInput = z.object({ teamId: z.string().uuid() });
export type ListSegmentsInput = z.infer<typeof ListSegmentsInput>;

// Restituisce il segmento che corrisponde a una categoria, creandolo se non
// esiste: consente di scegliere una categoria come destinatari di una
// campagna senza dover prima costruire un segmento a mano.
export const EnsureCategorySegmentInput = z.object({
  teamId: z.string().uuid(),
  category: z.string().min(1),
});
export type EnsureCategorySegmentInput = z.infer<typeof EnsureCategorySegmentInput>;

export const ListContactsInput = z.object({
  teamId: z.string().uuid(),
  search: z.string().optional(),
  tag: z.string().optional(),
  category: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});
export type ListContactsInput = z.infer<typeof ListContactsInput>;

export const ContactOutput = z.object({
  id: z.string().uuid(),
  phoneE164: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  tags: z.array(z.string()),
  categories: z.array(z.string()),
  customFields: z.record(z.string()),
  createdAt: z.string().datetime(),
});
export type ContactOutput = z.infer<typeof ContactOutput>;

export const ListContactsOutput = z.object({
  contacts: z.array(ContactOutput),
  total: z.number().int(),
  // Tutte le chiavi di campi custom presenti nel team: servono a popolare
  // l'elenco delle variabili disponibili quando si costruisce una campagna.
  availableCustomFields: z.array(z.string()),
  availableTags: z.array(z.string()),
  availableCategories: z.array(z.object({ name: z.string(), contactCount: z.number().int() })),
});
export type ListContactsOutput = z.infer<typeof ListContactsOutput>;

export const GetContactInput = z.object({ teamId: z.string().uuid(), contactId: z.string().uuid() });
export type GetContactInput = z.infer<typeof GetContactInput>;

export const UpdateContactInput = z.object({
  teamId: z.string().uuid(),
  contactId: z.string().uuid(),
  phoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/, "phone must be E.164").optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  tags: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  customFields: z.record(z.string()).optional(),
});
export type UpdateContactInput = z.infer<typeof UpdateContactInput>;

export const ContactConversationSummary = z.object({
  id: z.string().uuid(),
  lastMessagePreview: z.string(),
  lastMessageAt: z.string().datetime(),
  messageCount: z.number().int(),
  closedAt: z.string().datetime().nullable(),
});
export type ContactConversationSummary = z.infer<typeof ContactConversationSummary>;

export const ContactCampaignSummary = z.object({
  campaignId: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  sentAt: z.string().datetime().nullable(),
  messageStatus: z.string().nullable(),
});
export type ContactCampaignSummary = z.infer<typeof ContactCampaignSummary>;

export const ContactDetailOutput = z.object({
  contact: ContactOutput,
  conversations: z.array(ContactConversationSummary),
  campaigns: z.array(ContactCampaignSummary),
  possibleDuplicates: z.array(
    z.object({ id: z.string().uuid(), phoneE164: z.string(), name: z.string().nullable(), reason: z.string() }),
  ),
});
export type ContactDetailOutput = z.infer<typeof ContactDetailOutput>;

// Cerca contatti la cui identità sembra sovrapporsi (stesso numero scritto
// diversamente, o stesso nome+cognome con numeri diversi): una scansione
// esplicita, non un modello — ogni suggerimento è spiegabile a schermo.
export const FindDuplicateContactsInput = z.object({ teamId: z.string().uuid() });
export type FindDuplicateContactsInput = z.infer<typeof FindDuplicateContactsInput>;

export const DuplicateGroup = z.object({
  reason: z.enum(["SAME_NORMALIZED_PHONE", "SAME_NAME"]),
  contacts: z.array(ContactOutput),
});
export type DuplicateGroup = z.infer<typeof DuplicateGroup>;

export const MergeContactsInput = z.object({
  teamId: z.string().uuid(),
  // Il contatto che resta: gli altri vengono fusi dentro e cancellati.
  keepContactId: z.string().uuid(),
  mergeContactIds: z.array(z.string().uuid()).min(1),
});
export type MergeContactsInput = z.infer<typeof MergeContactsInput>;

export const ExportContactsInput = z.object({
  teamId: z.string().uuid(),
  segmentId: z.string().uuid().optional(),
  category: z.string().optional(),
});
export type ExportContactsInput = z.infer<typeof ExportContactsInput>;

export const ExportContactsOutput = z.object({
  csv: z.string(),
  filename: z.string(),
  count: z.number().int(),
});
export type ExportContactsOutput = z.infer<typeof ExportContactsOutput>;

export const CONTACTS_TOOLS = {
  "contacts.import": { input: ImportContactsInput, output: ImportContactsOutput },
  "contacts.tag": { input: TagContactsInput, output: z.object({ updated: z.number().int() }) },
  "contacts.assignCategories": {
    input: AssignCategoriesInput,
    output: z.object({ updated: z.number().int() }),
  },
  "contacts.list": { input: ListContactsInput, output: ListContactsOutput },
  "contacts.createSegment": { input: CreateSegmentInput, output: SegmentOutput },
  "contacts.listSegments": { input: ListSegmentsInput, output: z.array(SegmentOutput) },
  "contacts.ensureCategorySegment": { input: EnsureCategorySegmentInput, output: SegmentOutput },
  "contacts.get": { input: GetContactInput, output: ContactDetailOutput },
  "contacts.update": { input: UpdateContactInput, output: ContactOutput },
  "contacts.findDuplicates": { input: FindDuplicateContactsInput, output: z.array(DuplicateGroup) },
  "contacts.merge": { input: MergeContactsInput, output: ContactOutput },
  "contacts.export": { input: ExportContactsInput, output: ExportContactsOutput },
} as const;
