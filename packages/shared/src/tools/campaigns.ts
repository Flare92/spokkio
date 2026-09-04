import { z } from "zod";
import { MessageCategoryValues } from "../enums";

export const CostEstimateInput = z.object({
  teamId: z.string().uuid(),
  segmentId: z.string().uuid(),
  templateCategory: z.enum(MessageCategoryValues),
});
export type CostEstimateInput = z.infer<typeof CostEstimateInput>;

// The cost simulator is a first-class tool, not a UI-only widget, so it can be
// called before every send and embedded in onboarding — see constraint: no
// surprise invoices, always show a realistic pre-purchase cost scenario.
export const CostEstimateOutput = z.object({
  recipientCount: z.number().int(),
  metaCostPerConversation: z.number().nonnegative(),
  platformMarkupPerConversation: z.number().nonnegative(),
  totalPerConversation: z.number().nonnegative(),
  estimatedTotal: z.number().nonnegative(),
  currency: z.literal("EUR"),
  breakdown: z.object({
    metaTotal: z.number().nonnegative(),
    markupTotal: z.number().nonnegative(),
  }),
});
export type CostEstimateOutput = z.infer<typeof CostEstimateOutput>;

// Sorgente di una variabile del template: un campo standard del contatto,
// un campo personalizzato importato da file, o un valore fisso uguale per
// tutti i destinatari.
export const VariableSource = z.object({
  kind: z.enum(["CONTACT_FIELD", "CUSTOM_FIELD", "STATIC"]),
  value: z.string(), // nome del campo, oppure il testo fisso se kind = STATIC
  // Usato quando il contatto non ha quel campo valorizzato: senza fallback
  // Meta rifiuta il messaggio se una variabile risulta vuota.
  fallback: z.string().default(""),
});
export type VariableSource = z.infer<typeof VariableSource>;

export const CreateCampaignInput = z.object({
  teamId: z.string().uuid(),
  name: z.string().min(1),
  segmentId: z.string().uuid(),
  templateId: z.string().uuid(),
  scheduledAt: z.string().datetime().optional(),
  // Una voce per ogni variabile del template, in ordine ({{1}}, {{2}}, ...).
  variableMapping: z.array(VariableSource).default([]),
});
export type CreateCampaignInput = z.infer<typeof CreateCampaignInput>;

export const CampaignOutput = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  recipientCount: z.number().int(),
  scheduledAt: z.string().datetime().nullable(),
  sentAt: z.string().datetime().nullable(),
  templateName: z.string(),
  segmentName: z.string(),
  createdAt: z.string().datetime(),
});
export type CampaignOutput = z.infer<typeof CampaignOutput>;

export const SendCampaignInput = z.object({
  teamId: z.string().uuid(),
  campaignId: z.string().uuid(),
  // Sending requires the caller to have already seen (and accepted) the cost
  // estimate for this exact send — enforced server-side, never skippable.
  acceptedCostEstimateTotal: z.number().nonnegative(),
});
export type SendCampaignInput = z.infer<typeof SendCampaignInput>;

export const ListCampaignsInput = z.object({ teamId: z.string().uuid() });
export type ListCampaignsInput = z.infer<typeof ListCampaignsInput>;

// Anteprima del messaggio effettivo per i primi destinatari reali del
// segmento: è il modo più diretto per accorgersi di una variabile mappata
// sul campo sbagliato prima di spendere soldi in un invio.
export const PreviewCampaignInput = z.object({
  teamId: z.string().uuid(),
  segmentId: z.string().uuid(),
  templateId: z.string().uuid(),
  variableMapping: z.array(VariableSource).default([]),
  limit: z.number().int().min(1).max(10).default(3),
});
export type PreviewCampaignInput = z.infer<typeof PreviewCampaignInput>;

export const PreviewCampaignOutput = z.array(
  z.object({
    contactId: z.string().uuid(),
    phoneE164: z.string(),
    renderedText: z.string(),
    missingVariables: z.array(z.string()),
  }),
);
export type PreviewCampaignOutput = z.infer<typeof PreviewCampaignOutput>;

export const CancelScheduledCampaignInput = z.object({
  teamId: z.string().uuid(),
  campaignId: z.string().uuid(),
});
export type CancelScheduledCampaignInput = z.infer<typeof CancelScheduledCampaignInput>;

export const CAMPAIGNS_TOOLS = {
  "campaigns.estimateCost": { input: CostEstimateInput, output: CostEstimateOutput },
  "campaigns.create": { input: CreateCampaignInput, output: CampaignOutput },
  "campaigns.send": { input: SendCampaignInput, output: CampaignOutput },
  "campaigns.list": { input: ListCampaignsInput, output: z.array(CampaignOutput) },
  "campaigns.preview": { input: PreviewCampaignInput, output: PreviewCampaignOutput },
  "campaigns.cancelScheduled": { input: CancelScheduledCampaignInput, output: CampaignOutput },
} as const;
