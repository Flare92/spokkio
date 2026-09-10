import { z } from "zod";
import { AutomationTriggerTypeValues } from "../enums";

// Fase 1 ships 3 ready-to-use triggers; da Fase 1.5 l'utente può creare
// automazioni personalizzate: stesso trigger di base, ma nome, template e
// condizioni (categoria/tag) a scelta — più automazioni indipendenti con lo
// stesso meccanismo tecnico sottostante.
export const CreateAutomationInput = z.object({
  teamId: z.string().uuid(),
  name: z.string().min(1).optional(),
  triggerType: z.enum(AutomationTriggerTypeValues),
  templateId: z.string().uuid(),
  // Minutes before/after the reference event (appointment time, visit time,
  // last contact activity, contact creation) at which the message fires.
  offsetMinutes: z.number().int(),
  // Se valorizzate, l'automazione scatta solo per i contatti che hanno
  // almeno una delle categorie/tag elencati.
  matchCategories: z.array(z.string()).default([]),
  matchTags: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});
export type CreateAutomationInput = z.infer<typeof CreateAutomationInput>;

export const AutomationOutput = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  triggerType: z.enum(AutomationTriggerTypeValues),
  templateId: z.string().uuid(),
  templateName: z.string(),
  offsetMinutes: z.number().int(),
  matchCategories: z.array(z.string()),
  matchTags: z.array(z.string()),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
});
export type AutomationOutput = z.infer<typeof AutomationOutput>;

export const ListAutomationsInput = z.object({ teamId: z.string().uuid() });
export type ListAutomationsInput = z.infer<typeof ListAutomationsInput>;

export const UpdateAutomationInput = z.object({
  teamId: z.string().uuid(),
  automationId: z.string().uuid(),
  name: z.string().min(1).nullable().optional(),
  templateId: z.string().uuid().optional(),
  offsetMinutes: z.number().int().optional(),
  matchCategories: z.array(z.string()).optional(),
  matchTags: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateAutomationInput = z.infer<typeof UpdateAutomationInput>;

export const DeleteAutomationInput = z.object({
  teamId: z.string().uuid(),
  automationId: z.string().uuid(),
});
export type DeleteAutomationInput = z.infer<typeof DeleteAutomationInput>;

export const AUTOMATIONS_TOOLS = {
  "automations.create": { input: CreateAutomationInput, output: AutomationOutput },
  "automations.list": { input: ListAutomationsInput, output: z.array(AutomationOutput) },
  "automations.update": { input: UpdateAutomationInput, output: AutomationOutput },
  "automations.delete": { input: DeleteAutomationInput, output: z.object({ deleted: z.literal(true) }) },
} as const;
