import type { VariableSource } from "@spokkio/shared";

export interface RenderableContact {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phoneE164: string;
  customFields: unknown;
}

export interface RenderResult {
  text: string;
  // Valori posizionali da passare a Meta come parametri del template
  // ({{1}} -> values[0], {{2}} -> values[1], ...).
  values: string[];
  missingVariables: string[];
}

// Sostituisce i segnaposto {{1}}, {{2}}, ... del corpo del template con i
// valori del singolo contatto. Il testo reso viene salvato sul messaggio,
// così l'inbox e lo storico mostrano davvero ciò che il cliente ha ricevuto
// invece del template grezzo.
export function renderTemplate(
  bodyText: string,
  mapping: VariableSource[],
  contact: RenderableContact,
): RenderResult {
  const custom = (contact.customFields as Record<string, string>) ?? {};
  const missingVariables: string[] = [];

  const values = mapping.map((source, index) => {
    let raw = "";
    if (source.kind === "STATIC") {
      raw = source.value;
    } else if (source.kind === "CONTACT_FIELD") {
      raw = String((contact as unknown as Record<string, unknown>)[source.value] ?? "");
    } else {
      raw = custom[source.value] ?? "";
    }

    const value = raw.trim();
    if (!value) {
      // Meta rifiuta il messaggio se un parametro è vuoto: il fallback non è
      // un vezzo di comodità ma la condizione perché l'invio non fallisca.
      if (!source.fallback) missingVariables.push(`{{${index + 1}}} (${source.value})`);
      return source.fallback;
    }
    return value;
  });

  const text = bodyText.replace(/\{\{(\d+)\}\}/g, (match, position) => {
    const value = values[Number(position) - 1];
    return value === undefined ? match : value;
  });

  return { text, values, missingVariables };
}

// Quante variabili distinte usa davvero il corpo del template: serve a non
// far configurare una mappatura più corta di quella richiesta da Meta.
export function countTemplateVariables(bodyText: string): number {
  const positions = new Set<number>();
  for (const match of bodyText.matchAll(/\{\{(\d+)\}\}/g)) {
    positions.add(Number(match[1]));
  }
  return positions.size === 0 ? 0 : Math.max(...positions);
}
