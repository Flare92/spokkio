import { z } from "zod";
import { AutomationTriggerTypeValues } from "../enums";

// Fase 1 ships fixed, ready-to-use triggers for the local-services vertical
// (beauty & wellness, ristorazione) — not a free-form builder yet (that's Fase 2).
export const CreateAutomationInput = z.object({
  teamId: z.string().uuid(),
  triggerType: z.enum(AutomationTriggerTypeValues),
  templateId: z.string().uuid(),
  // Minutes before/after the reference event (appointment time, visit time,
  // last contact activity) at which the message fires.
  offsetMinutes: z.number().int(),
  enabled: z.boolean().default(true),
});
export type CreateAutomationInput = z.infer<typeof CreateAutomationInput>;

export const AutomationOutput = z.object({
  id: z.string().uuid(),
  triggerType: z.enum(AutomationTriggerTypeValues),
  templateId: z.string().uuid(),
  offsetMinutes: z.number().int(),
  enabled: z.boolean(),
});
export type AutomationOutput = z.infer<typeof AutomationOutput>;

export const AUTOMATIONS_TOOLS = {
  "automations.create": { input: CreateAutomationInput, output: AutomationOutput },
} as const;
