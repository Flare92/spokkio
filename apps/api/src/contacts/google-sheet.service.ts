import { BadRequestException, Injectable } from "@nestjs/common";
import Papa from "papaparse";
import type { FetchGoogleSheetInput, FetchGoogleSheetOutput } from "@spokkio/shared";

const SHEET_ID_PATTERN = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
const GID_PATTERN = /[?#&]gid=(\d+)/;

@Injectable()
export class GoogleSheetService {
  // Tool: contacts.fetchGoogleSheet
  // Non usa le API ufficiali di Google (che richiederebbero un progetto
  // OAuth a carico dell'utente): scarica l'esportazione CSV pubblica dello
  // stesso foglio, disponibile per qualunque foglio condiviso come
  // "chiunque abbia il link può visualizzare".
  async fetch(input: FetchGoogleSheetInput): Promise<FetchGoogleSheetOutput> {
    const sheetId = SHEET_ID_PATTERN.exec(input.url)?.[1];
    if (!sheetId) {
      throw new BadRequestException(
        "Link non riconosciuto: incolla l'URL del foglio così come lo trovi nella barra degli indirizzi (deve contenere /spreadsheets/d/...)",
      );
    }
    const gid = GID_PATTERN.exec(input.url)?.[1] ?? "0";

    const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    const response = await fetch(exportUrl, { redirect: "follow" });
    const text = await response.text();

    if (!response.ok || looksLikeHtml(text)) {
      throw new BadRequestException(
        "Impossibile leggere il foglio. Verifica che sia condiviso come \"Chiunque abbia il link\" → \"Visualizzatore\" e riprova.",
      );
    }

    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    if ((parsed.meta.fields ?? []).length === 0) {
      throw new BadRequestException("Il foglio sembra vuoto o non contiene un'intestazione di colonne.");
    }

    return {
      headers: (parsed.meta.fields ?? []).map((h) => h.trim()),
      rows: (parsed.data ?? []).map((row) =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v ?? "").trim()])),
      ),
    };
  }
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 200).toLowerCase();
  return head.includes("<!doctype html") || head.includes("<html");
}
