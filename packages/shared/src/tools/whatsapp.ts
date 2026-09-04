import { z } from "zod";

export const ConnectWhatsAppInput = z.object({
  teamId: z.string().uuid(),
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
  displayPhoneNumber: z.string().min(1),
  accessToken: z.string().min(1),
});
export type ConnectWhatsAppInput = z.infer<typeof ConnectWhatsAppInput>;

export const WhatsAppConnectionStatusInput = z.object({ teamId: z.string().uuid() });
export type WhatsAppConnectionStatusInput = z.infer<typeof WhatsAppConnectionStatusInput>;

// Il token non viene mai restituito, nemmeno parzialmente: la UI deve poter
// mostrare lo stato della connessione senza che il segreto giri di nuovo in
// rete a ogni caricamento di pagina.
export const WhatsAppConnectionStatusOutput = z.object({
  connected: z.boolean(),
  wabaId: z.string().nullable(),
  phoneNumberId: z.string().nullable(),
  displayPhoneNumber: z.string().nullable(),
  connectedAt: z.string().datetime().nullable(),
  // Esito di una chiamata di verifica verso Meta con le credenziali salvate.
  tokenValid: z.boolean().nullable(),
  tokenError: z.string().nullable(),
});
export type WhatsAppConnectionStatusOutput = z.infer<typeof WhatsAppConnectionStatusOutput>;

export const WHATSAPP_TOOLS = {
  "whatsapp.connect": { input: ConnectWhatsAppInput, output: WhatsAppConnectionStatusOutput },
  "whatsapp.connectionStatus": {
    input: WhatsAppConnectionStatusInput,
    output: WhatsAppConnectionStatusOutput,
  },
} as const;
