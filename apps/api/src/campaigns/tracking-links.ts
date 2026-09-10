import { randomUUID } from "crypto";

// Deve essere l'URL pubblico raggiungibile da chi riceve il messaggio (in
// locale, il tunnel ngrok già usato per il webhook Meta) — altrimenti il
// link di redirect non è cliccabile dal telefono del cliente.
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");

const URL_PATTERN = /^https?:\/\/\S+$/;

export function isTrackableUrl(value: string): boolean {
  return URL_PATTERN.test(value.trim());
}

export function buildTrackingUrl(token: string): string {
  return `${PUBLIC_BASE_URL}/api/v1/t/${token}`;
}

export function newTrackingToken(): string {
  return randomUUID();
}
