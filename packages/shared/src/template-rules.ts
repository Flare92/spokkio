// Regole di Meta sui template, controllate prima della sottomissione: ogni
// errore preso qui è un tentativo di revisione risparmiato e un messaggio
// comprensibile invece del generico "Invalid parameter" di Meta. Usate sia
// dall'API (blocco) sia dall'interfaccia (avvisi mentre si scrive).

export const TEMPLATE_NAME_PATTERN = /^[a-z0-9_]+$/;
const BODY_MAX_LENGTH = 1024;

export function findTemplateProblems(input: { name: string; bodyText: string }): string[] {
  const problems: string[] = [];
  const body = input.bodyText;
  const trimmed = body.trim();

  if (!TEMPLATE_NAME_PATTERN.test(input.name)) {
    problems.push("Il nome può contenere solo lettere minuscole, numeri e _ (es. promo_autunno).");
  }
  if (input.name.length > 512) problems.push("Il nome è troppo lungo.");
  if (trimmed.length === 0) problems.push("Il testo è vuoto.");
  if (body.length > BODY_MAX_LENGTH) {
    problems.push(`Il testo supera i ${BODY_MAX_LENGTH} caratteri ammessi da Meta (ora ${body.length}).`);
  }

  // {{nome}}, {{ }} e {1} / {nome} con una graffa sola.
  const malformed = body.match(/\{\{\s*[^}\d\s][^}]*\}\}|\{\{\s*\}\}|(?<!\{)\{(?!\{)[^{}]+\}(?!\})/g);
  if (malformed) {
    problems.push(
      `Variabili scritte male: ${malformed.join(", ")}. Usa due graffe e un numero, es. {{1}}.`,
    );
  }

  const positions = Array.from(body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).map((m) => Number(m[1]));
  const distinct = Array.from(new Set(positions)).sort((a, b) => a - b);
  if (distinct.length > 0) {
    if (distinct.some((n, i) => n !== i + 1)) {
      problems.push(
        `Le variabili devono essere numerate in ordine senza salti: {{1}}, {{2}}, {{3}}… (trovate ${distinct
          .map((n) => `{{${n}}}`)
          .join(", ")}).`,
      );
    }
    if (/^\{\{\s*\d+\s*\}\}/.test(trimmed) || /\{\{\s*\d+\s*\}\}[\s.!?…]*$/.test(trimmed)) {
      problems.push(
        "Il testo non può iniziare o finire con una variabile: aggiungi una parola prima (es. \"Ciao {{1}}\") o una frase dopo.",
      );
    }
    if (/\{\{\s*\d+\s*\}\}\s*\{\{\s*\d+\s*\}\}/.test(body)) {
      problems.push("Due variabili non possono stare attaccate: separale con del testo (es. \"{{1}} e {{2}}\").");
    }
    // Meta rifiuta i template con "troppe variabili per la lunghezza del testo".
    const words = trimmed.replace(/\{\{\s*\d+\s*\}\}/g, " ").split(/\s+/).filter(Boolean).length;
    if (words < distinct.length * 3) {
      problems.push(
        `Troppe variabili per un testo così breve (${distinct.length} variabili, ${words} parole): aggiungi testo fisso intorno alle variabili.`,
      );
    }
  }

  if (/\n\s*\n\s*\n/.test(body)) problems.push("Non sono ammesse più di due righe vuote consecutive.");
  if (/ {5,}|\t/.test(body)) problems.push("Togli le tabulazioni e le sequenze di molti spazi.");

  return problems;
}

// Codici con cui Meta motiva un rifiuto, tradotti in cosa fare.
const REJECTION_EXPLANATIONS: Record<string, string> = {
  INVALID_FORMAT:
    "Formato non valido: di solito variabili scritte male, che iniziano o chiudono il testo, attaccate fra loro, o troppe per un testo breve. Controlla le {{1}}, {{2}} e aggiungi testo fisso intorno.",
  TAG_CONTENT_MISMATCH:
    "La categoria non corrisponde al contenuto: un messaggio con offerte, sconti o inviti a comprare va creato come MARKETING, non UTILITY.",
  INCORRECT_CATEGORY:
    "Categoria sbagliata: Meta ritiene che il messaggio appartenga a un'altra categoria. Se contiene promozioni, usa MARKETING.",
  PROMOTIONAL:
    "Contenuto promozionale in un template UTILITY: crea il template come MARKETING oppure togli sconti e inviti all'acquisto.",
  ABUSIVE_CONTENT:
    "Contenuto ritenuto non conforme alle regole di WhatsApp (linguaggio, prodotti vietati, richieste di dati sensibili). Riformula il testo in modo più neutro.",
  SCAM: "Meta l'ha ritenuto un possibile tentativo di truffa: evita link accorciati, urgenze esagerate (\"solo oggi!!!\") e richieste di pagamento o dati.",
  INVALID_PARAMETERS:
    "Esempi delle variabili non validi: ricrea il template assicurandoti che ogni {{n}} abbia senso con un valore d'esempio.",
};

export function explainRejection(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const code = reason.trim().toUpperCase().replace(/\s+/g, "_");
  return REJECTION_EXPLANATIONS[code] ?? null;
}
