import { z } from "zod";

// Limiti di WhatsApp per le immagini negli header dei template.
export const MEDIA_IMAGE_MIME_TYPES = ["image/jpeg", "image/png"] as const;
export const MEDIA_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const UploadMediaInput = z.object({
  teamId: z.string().uuid(),
  filename: z.string().min(1).max(200),
  mimeType: z.enum(MEDIA_IMAGE_MIME_TYPES),
  // Contenuto del file in base64 (senza il prefisso "data:...;base64,").
  dataBase64: z.string().min(1),
});
export type UploadMediaInput = z.infer<typeof UploadMediaInput>;

export const MediaOutput = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
});
export type MediaOutput = z.infer<typeof MediaOutput>;

export const GetMediaInput = z.object({ teamId: z.string().uuid(), mediaId: z.string().uuid() });
export type GetMediaInput = z.infer<typeof GetMediaInput>;

export const GetMediaOutput = MediaOutput.extend({ dataBase64: z.string() });
export type GetMediaOutput = z.infer<typeof GetMediaOutput>;

export const MEDIA_TOOLS = {
  "media.upload": { input: UploadMediaInput, output: MediaOutput },
  "media.get": { input: GetMediaInput, output: GetMediaOutput },
} as const;
