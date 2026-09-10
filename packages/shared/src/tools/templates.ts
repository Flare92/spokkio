import { z } from "zod";
import { MessageCategoryValues, TemplateStatusValues } from "../enums";

export const CreateTemplateInput = z.object({
  teamId: z.string().uuid(),
  name: z.string().min(1),
  category: z.enum(MessageCategoryValues),
  language: z.string().min(2).max(10).default("it"),
  bodyText: z.string().min(1),
  variables: z.array(z.string()).default([]),
});
export type CreateTemplateInput = z.infer<typeof CreateTemplateInput>;

export const TemplateOutput = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category: z.enum(MessageCategoryValues),
  status: z.enum(TemplateStatusValues),
  language: z.string(),
  // Serve al costruttore di campagne per capire quante variabili ({{1}},
  // {{2}}, ...) vanno mappate e per mostrare l'anteprima del testo.
  bodyText: z.string(),
  rejectionReason: z.string().nullable(),
  // Compilati solo dopo una sottomissione reale a Meta (vedi
  // templates.submit) — null se il template è ancora solo locale.
  metaTemplateId: z.string().nullable(),
  submissionError: z.string().nullable(),
});
export type TemplateOutput = z.infer<typeof TemplateOutput>;

export const ListTemplatesInput = z.object({ teamId: z.string().uuid() });
export type ListTemplatesInput = z.infer<typeof ListTemplatesInput>;

// Sottomette un template già creato localmente alla review reale di Meta.
// L'esito arriva comunque in modo asincrono via webhook: questa chiamata
// dice solo se Meta ha accettato la richiesta di revisione.
export const SubmitTemplateInput = z.object({ teamId: z.string().uuid(), templateId: z.string().uuid() });
export type SubmitTemplateInput = z.infer<typeof SubmitTemplateInput>;

export const TEMPLATES_TOOLS = {
  "templates.create": { input: CreateTemplateInput, output: TemplateOutput },
  "templates.list": { input: ListTemplatesInput, output: z.array(TemplateOutput) },
  "templates.submit": { input: SubmitTemplateInput, output: TemplateOutput },
} as const;
