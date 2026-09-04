import Papa from "papaparse";
import * as XLSX from "xlsx";

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

// Campi "nativi" del contatto verso cui si può mappare una colonna del file.
// Tutto ciò che non è mappato qui può diventare un campo custom.
export const CONTACT_FIELDS = [
  { key: "phoneE164", label: "Telefono (obbligatorio)", required: true },
  { key: "firstName", label: "Nome", required: false },
  { key: "lastName", label: "Cognome", required: false },
  { key: "email", label: "Email", required: false },
  { key: "tags", label: "Tag (separati da virgola)", required: false },
] as const;

export type ContactFieldKey = (typeof CONTACT_FIELDS)[number]["key"];

export async function parseFile(file: File): Promise<ParsedFile> {
  const isExcel = /\.(xlsx|xls)$/i.test(file.name);
  return isExcel ? parseExcel(file) : parseDelimited(file);
}

async function parseExcel(file: File): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return { headers: [], rows: [] };

  // defval: "" mantiene le colonne vuote, altrimenti le righe avrebbero
  // chiavi diverse fra loro e la mappatura salterebbe delle colonne.
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  const normalized = rows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), String(v ?? "").trim()])),
  );
  return { headers: Object.keys(normalized[0] ?? {}), rows: normalized };
}

async function parseDelimited(file: File): Promise<ParsedFile> {
  const text = await file.text();
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    // Autorileva il separatore: i CSV esportati da Excel in Italia usano
    // spesso il punto e virgola invece della virgola.
    delimiter: "",
    transformHeader: (h) => h.trim(),
  });
  const rows = (result.data ?? []).map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "").trim()])),
  );
  return { headers: (result.meta.fields ?? []).map((h) => h.trim()), rows };
}

export interface PhoneNormalizationResult {
  ok: boolean;
  phoneE164?: string;
  reason?: string;
}

// I file reali contengono numeri in mille formati ("333 123 4567",
// "0039 333...", "+39-333-1234567"). Qui li riportiamo a E.164, che è
// l'unico formato accettato dall'API di WhatsApp.
export function normalizePhone(raw: string, defaultCountryCode: string): PhoneNormalizationResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "numero mancante" };

  let digits = trimmed.replace(/[\s().\-\/]/g, "");

  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith("+")) {
    // Un numero italiano scritto come "0039..." è già gestito sopra; qui
    // restano i numeri nazionali senza prefisso internazionale.
    digits = `${defaultCountryCode}${digits.replace(/^0+/, "")}`;
  }

  if (!/^\+[1-9]\d{6,14}$/.test(digits)) {
    return { ok: false, reason: `formato non valido: "${raw}"` };
  }
  return { ok: true, phoneE164: digits };
}

export interface ColumnMapping {
  // campo contatto -> nome colonna del file (o "" se non mappato)
  fields: Partial<Record<ContactFieldKey, string>>;
  // colonne del file da conservare come campi custom
  customColumns: string[];
}

export interface NormalizedRow {
  phoneE164: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  tags: string[];
  customFields: Record<string, string>;
}

export interface NormalizationSummary {
  valid: NormalizedRow[];
  invalid: { row: number; reason: string }[];
}

export function normalizeRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  options: { defaultCountryCode: string; extraTags: string[] },
): NormalizationSummary {
  const valid: NormalizedRow[] = [];
  const invalid: { row: number; reason: string }[] = [];

  const phoneColumn = mapping.fields.phoneE164;
  if (!phoneColumn) {
    return { valid, invalid: [{ row: 0, reason: "Nessuna colonna mappata sul telefono" }] };
  }

  rows.forEach((row, index) => {
    const phone = normalizePhone(row[phoneColumn] ?? "", options.defaultCountryCode);
    if (!phone.ok) {
      invalid.push({ row: index + 2, reason: phone.reason ?? "numero non valido" }); // +2: intestazione + base 1
      return;
    }

    const rawTags = mapping.fields.tags ? (row[mapping.fields.tags] ?? "") : "";
    const tags = [
      ...rawTags.split(/[,;]/).map((t) => t.trim()).filter(Boolean),
      ...options.extraTags,
    ];

    const customFields: Record<string, string> = {};
    for (const column of mapping.customColumns) {
      const value = (row[column] ?? "").trim();
      if (value) customFields[slugifyKey(column)] = value;
    }

    const email = mapping.fields.email ? (row[mapping.fields.email] ?? "").trim() : "";

    valid.push({
      phoneE164: phone.phoneE164!,
      firstName: mapping.fields.firstName ? row[mapping.fields.firstName] || undefined : undefined,
      lastName: mapping.fields.lastName ? row[mapping.fields.lastName] || undefined : undefined,
      // Un'email malformata non deve far scartare l'intero contatto: la
      // scartiamo e teniamo il resto (il canale principale è WhatsApp).
      email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : undefined,
      tags: Array.from(new Set(tags)),
      customFields,
    });
  });

  return { valid, invalid };
}

// Le chiavi dei campi custom diventano nomi di variabile nei template:
// meglio tenerle prevedibili (minuscole, senza spazi).
export function slugifyKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}
