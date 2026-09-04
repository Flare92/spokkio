"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/nav";
import { callTool, decodeTeamId } from "@/lib/api";

interface SegmentOutput {
  id: string;
  name: string;
  contactCount: number;
}
interface TemplateOutput {
  id: string;
  name: string;
  category: string;
  status: string;
  language?: string;
  bodyText?: string;
  rejectionReason: string | null;
}
interface CostEstimateOutput {
  recipientCount: number;
  metaCostPerConversation: number;
  platformMarkupPerConversation: number;
  totalPerConversation: number;
  estimatedTotal: number;
  currency: string;
}
interface CampaignOutput {
  id: string;
  name: string;
  status: string;
  recipientCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  templateName: string;
  segmentName: string;
  createdAt: string;
}
interface PreviewRow {
  contactId: string;
  phoneE164: string;
  renderedText: string;
  missingVariables: string[];
}
type VariableSource = {
  kind: "CONTACT_FIELD" | "CUSTOM_FIELD" | "STATIC";
  value: string;
  fallback: string;
};

const CONTACT_FIELD_OPTIONS = [
  { value: "firstName", label: "Nome" },
  { value: "lastName", label: "Cognome" },
  { value: "email", label: "Email" },
  { value: "phoneE164", label: "Telefono" },
];

export default function CampaignsPage() {
  const teamId = decodeTeamId();
  const [campaigns, setCampaigns] = useState<CampaignOutput[]>([]);
  const [segments, setSegments] = useState<SegmentOutput[]>([]);
  const [templates, setTemplates] = useState<TemplateOutput[]>([]);
  const [customFields, setCustomFields] = useState<string[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!teamId) return;
    try {
      const [c, s, t, contacts] = await Promise.all([
        callTool<CampaignOutput[]>("/campaigns/list", { teamId }),
        callTool<SegmentOutput[]>("/contacts/segments/list", { teamId }),
        callTool<TemplateOutput[]>("/templates/list", { teamId }),
        callTool<{ availableCustomFields: string[] }>("/contacts/list", { teamId, limit: 1 }),
      ]);
      setCampaigns(c);
      setSegments(s);
      setTemplates(t);
      setCustomFields(contacts.availableCustomFields);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Caricamento fallito");
    }
  }, [teamId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-5xl space-y-8 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Campagne</h1>
          <button
            onClick={() => setShowBuilder((v) => !v)}
            className="rounded bg-brand-dark px-4 py-2 text-sm font-medium text-white"
          >
            {showBuilder ? "Chiudi" : "Nuova campagna"}
          </button>
        </div>

        {showBuilder && (
          <CampaignBuilder
            teamId={teamId}
            segments={segments}
            templates={templates}
            customFields={customFields}
            onDone={() => {
              setShowBuilder(false);
              refresh();
            }}
          />
        )}

        <CampaignList teamId={teamId} campaigns={campaigns} onChanged={refresh} />

        <TemplatesSection teamId={teamId} templates={templates} onChanged={refresh} />

        {error && <p className="text-sm text-red-600">{error}</p>}
      </main>
    </div>
  );
}

function CampaignBuilder({
  teamId,
  segments,
  templates,
  customFields,
  onDone,
}: {
  teamId: string | null;
  segments: SegmentOutput[];
  templates: TemplateOutput[];
  customFields: string[];
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [mapping, setMapping] = useState<VariableSource[]>([]);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [estimate, setEstimate] = useState<CostEstimateOutput | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approvedTemplates = templates.filter((t) => t.status === "APPROVED");
  const selectedTemplate = approvedTemplates.find((t) => t.id === templateId);

  // Quante variabili richiede il corpo del template scelto.
  const variableCount = useMemo(() => {
    if (!selectedTemplate?.bodyText) return 0;
    const positions = new Set<number>();
    for (const m of selectedTemplate.bodyText.matchAll(/\{\{(\d+)\}\}/g)) positions.add(Number(m[1]));
    return positions.size === 0 ? 0 : Math.max(...positions);
  }, [selectedTemplate]);

  useEffect(() => {
    setMapping((prev) => {
      const next: VariableSource[] = [];
      for (let i = 0; i < variableCount; i++) {
        next.push(prev[i] ?? { kind: "CONTACT_FIELD", value: "firstName", fallback: "" });
      }
      return next;
    });
    setEstimate(null);
    setPreview(null);
  }, [variableCount, templateId]);

  async function handleEstimate() {
    if (!segmentId || !selectedTemplate) return;
    setError(null);
    try {
      // La stima usa la categoria reale del template: Meta fattura per
      // categoria e l'invio ricalcola sul valore effettivo, quindi usarne
      // un'altra qui farebbe fallire l'invio per costo non corrispondente.
      setEstimate(
        await callTool<CostEstimateOutput>("/campaigns/estimate-cost", {
          teamId,
          segmentId,
          templateCategory: selectedTemplate.category,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulazione costo fallita");
    }
  }

  async function handlePreview() {
    if (!segmentId || !templateId) return;
    setError(null);
    try {
      setPreview(
        await callTool<PreviewRow[]>("/campaigns/preview", {
          teamId,
          segmentId,
          templateId,
          variableMapping: mapping,
          limit: 3,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anteprima fallita");
    }
  }

  async function handleCreate(sendNow: boolean) {
    if (!segmentId || !templateId || !name) return;
    setBusy(true);
    setError(null);
    try {
      const campaign = await callTool<CampaignOutput>("/campaigns", {
        teamId,
        name,
        segmentId,
        templateId,
        variableMapping: mapping,
        scheduledAt: scheduleEnabled && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      });

      if (sendNow) {
        if (!estimate) {
          setError("Simula prima il costo: l'invio richiede che tu abbia accettato una stima.");
          setBusy(false);
          return;
        }
        await callTool("/campaigns/send", {
          teamId,
          campaignId: campaign.id,
          acceptedCostEstimateTotal: estimate.estimatedTotal,
        });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creazione campagna fallita");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5 rounded border bg-white p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-sm sm:col-span-3">
          <span className="mb-1 block text-gray-600">Nome campagna</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="es. Promo settembre"
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-gray-600">Destinatari (segmento)</span>
          <select
            value={segmentId}
            onChange={(e) => {
              setSegmentId(e.target.value);
              setEstimate(null);
              setPreview(null);
            }}
            className="w-full rounded border px-3 py-2 text-sm"
          >
            <option value="">Seleziona…</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.contactCount})
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-gray-600">Template approvato</span>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          >
            <option value="">Seleziona…</option>
            {approvedTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.category} · {t.language}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedTemplate?.bodyText && (
        <div className="rounded bg-gray-50 p-3 text-sm">
          <span className="mb-1 block text-xs uppercase text-gray-400">Testo del template</span>
          {selectedTemplate.bodyText}
        </div>
      )}

      {variableCount > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">
            Variabili ({variableCount}) — da cosa prende il valore ogni segnaposto
          </h3>
          <div className="space-y-2">
            {mapping.map((source, index) => (
              <div key={index} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[60px_1fr_1fr_1fr]">
                <code className="text-sm text-gray-500">{`{{${index + 1}}}`}</code>
                <select
                  value={source.kind}
                  onChange={(e) => {
                    const kind = e.target.value as VariableSource["kind"];
                    setMapping((m) =>
                      m.map((s, i) =>
                        i === index
                          ? {
                              ...s,
                              kind,
                              value:
                                kind === "CONTACT_FIELD" ? "firstName" : kind === "CUSTOM_FIELD" ? (customFields[0] ?? "") : "",
                            }
                          : s,
                      ),
                    );
                    setPreview(null);
                  }}
                  className="rounded border px-2 py-1.5 text-sm"
                >
                  <option value="CONTACT_FIELD">Campo contatto</option>
                  <option value="CUSTOM_FIELD">Campo personalizzato</option>
                  <option value="STATIC">Testo fisso</option>
                </select>

                {source.kind === "STATIC" ? (
                  <input
                    value={source.value}
                    onChange={(e) => {
                      setMapping((m) => m.map((s, i) => (i === index ? { ...s, value: e.target.value } : s)));
                      setPreview(null);
                    }}
                    placeholder="testo uguale per tutti"
                    className="rounded border px-2 py-1.5 text-sm"
                  />
                ) : (
                  <select
                    value={source.value}
                    onChange={(e) => {
                      setMapping((m) => m.map((s, i) => (i === index ? { ...s, value: e.target.value } : s)));
                      setPreview(null);
                    }}
                    className="rounded border px-2 py-1.5 text-sm"
                  >
                    {(source.kind === "CONTACT_FIELD"
                      ? CONTACT_FIELD_OPTIONS
                      : customFields.map((f) => ({ value: f, label: f }))
                    ).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                    {source.kind === "CUSTOM_FIELD" && customFields.length === 0 && (
                      <option value="">nessun campo importato</option>
                    )}
                  </select>
                )}

                <input
                  value={source.fallback}
                  onChange={(e) => {
                    setMapping((m) => m.map((s, i) => (i === index ? { ...s, fallback: e.target.value } : s)));
                    setPreview(null);
                  }}
                  placeholder="valore se vuoto (consigliato)"
                  className="rounded border px-2 py-1.5 text-sm"
                />
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Il valore di riserva evita che Meta rifiuti il messaggio quando un contatto non ha quel dato.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handlePreview}
          disabled={!segmentId || !templateId}
          className="rounded border px-4 py-2 text-sm disabled:opacity-40"
        >
          Anteprima messaggio
        </button>
        <button
          type="button"
          onClick={handleEstimate}
          disabled={!segmentId || !templateId}
          className="rounded border px-4 py-2 text-sm disabled:opacity-40"
        >
          Simula costo
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={scheduleEnabled}
            onChange={(e) => setScheduleEnabled(e.target.checked)}
          />
          Programma invio
        </label>
        {scheduleEnabled && (
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="rounded border px-2 py-1.5 text-sm"
          />
        )}
      </div>

      {preview && (
        <div className="rounded border">
          <div className="border-b bg-gray-50 px-3 py-1.5 text-xs uppercase text-gray-500">
            Come arriverà ai primi destinatari
          </div>
          <ul className="divide-y">
            {preview.map((p) => (
              <li key={p.contactId} className="px-3 py-2 text-sm">
                <span className="font-mono text-xs text-gray-500">{p.phoneE164}</span>
                <p className="mt-0.5 whitespace-pre-wrap">{p.renderedText}</p>
                {p.missingVariables.length > 0 && (
                  <p className="mt-1 text-xs text-red-600">
                    Variabili senza valore né riserva: {p.missingVariables.join(", ")}
                  </p>
                )}
              </li>
            ))}
            {preview.length === 0 && (
              <li className="px-3 py-3 text-sm text-gray-400">Il segmento non contiene contatti.</li>
            )}
          </ul>
        </div>
      )}

      {estimate && (
        <div className="rounded border bg-gray-50 p-3 text-sm">
          <div className="flex justify-between">
            <span>Destinatari</span>
            <span>{estimate.recipientCount}</span>
          </div>
          <div className="flex justify-between">
            <span>Costo Meta / conversazione</span>
            <span>€{estimate.metaCostPerConversation.toFixed(4)}</span>
          </div>
          <div className="flex justify-between">
            <span>Markup Spokkio / conversazione</span>
            <span>€{estimate.platformMarkupPerConversation.toFixed(4)}</span>
          </div>
          <div className="flex justify-between border-t pt-1 font-semibold">
            <span>Totale stimato</span>
            <span>
              €{estimate.estimatedTotal.toFixed(2)} {estimate.currency}
            </span>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => handleCreate(false)}
          disabled={busy || !name || !segmentId || !templateId}
          className="rounded border px-4 py-2 text-sm disabled:opacity-40"
        >
          {scheduleEnabled ? "Programma" : "Salva come bozza"}
        </button>
        {!scheduleEnabled && (
          <button
            onClick={() => handleCreate(true)}
            disabled={busy || !name || !segmentId || !templateId || !estimate}
            className="rounded bg-brand-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? "Invio…" : "Invia ora (accetto il costo stimato)"}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

function CampaignList({
  teamId,
  campaigns,
  onChanged,
}: {
  teamId: string | null;
  campaigns: CampaignOutput[];
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function cancel(campaignId: string) {
    setError(null);
    try {
      await callTool("/campaigns/cancel-scheduled", { teamId, campaignId });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Annullamento fallito");
    }
  }

  return (
    <section>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Campagna</th>
              <th className="px-3 py-2">Segmento</th>
              <th className="px-3 py-2">Template</th>
              <th className="px-3 py-2">Destinatari</th>
              <th className="px-3 py-2">Stato</th>
              <th className="px-3 py-2">Quando</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-3 py-2 font-medium">{c.name}</td>
                <td className="px-3 py-2 text-gray-600">{c.segmentName}</td>
                <td className="px-3 py-2 text-gray-600">{c.templateName}</td>
                <td className="px-3 py-2">{c.recipientCount}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {c.sentAt
                    ? `Inviata ${new Date(c.sentAt).toLocaleString("it-IT")}`
                    : c.scheduledAt
                      ? `Programmata ${new Date(c.scheduledAt).toLocaleString("it-IT")}`
                      : `Creata ${new Date(c.createdAt).toLocaleDateString("it-IT")}`}
                </td>
                <td className="px-3 py-2 text-right">
                  {c.status === "SCHEDULED" && (
                    <button onClick={() => cancel(c.id)} className="text-xs text-gray-500 underline">
                      annulla
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-gray-400">
                  Nessuna campagna. Creane una con il pulsante qui sopra.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    DRAFT: "bg-gray-100 text-gray-600",
    SCHEDULED: "bg-blue-50 text-blue-700",
    SENDING: "bg-amber-50 text-amber-700",
    SENT: "bg-green-50 text-green-700",
    FAILED: "bg-red-50 text-red-700",
  };
  const labels: Record<string, string> = {
    DRAFT: "bozza",
    SCHEDULED: "programmata",
    SENDING: "in invio",
    SENT: "inviata",
    FAILED: "fallita",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${styles[status] ?? "bg-gray-100"}`}>
      {labels[status] ?? status}
    </span>
  );
}

function TemplatesSection({
  teamId,
  templates,
  onChanged,
}: {
  teamId: string | null;
  templates: TemplateOutput[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("MARKETING");
  const [language, setLanguage] = useState("it");
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await callTool("/templates", { teamId, name, category, language, bodyText: body, variables: [] });
      setName("");
      setBody("");
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creazione template fallita");
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Template</h2>
        <button onClick={() => setOpen((v) => !v)} className="text-sm text-brand-dark underline">
          {open ? "chiudi" : "nuovo template"}
        </button>
      </div>
      <p className="mb-3 text-sm text-gray-500">
        Usa <code className="rounded bg-gray-100 px-1">{"{{1}}"}</code>,{" "}
        <code className="rounded bg-gray-100 px-1">{"{{2}}"}</code> nel testo per i valori personalizzati. Il
        template va approvato da Meta prima di poter essere usato in una campagna.
      </p>

      {open && (
        <form onSubmit={create} className="mb-3 space-y-3 rounded border bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input
              required
              placeholder="nome_template"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded border px-3 py-2 text-sm"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded border px-3 py-2 text-sm"
            >
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utility (promemoria, aggiornamenti)</option>
              <option value="AUTHENTICATION">Authentication</option>
            </select>
            <input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="it"
              className="rounded border px-3 py-2 text-sm"
            />
          </div>
          <textarea
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Ciao {{1}}, ti aspettiamo il {{2}}!"
            className="h-24 w-full rounded border px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded bg-brand-dark px-4 py-2 text-sm font-medium text-white">
            Crea template
          </button>
        </form>
      )}

      <ul className="space-y-1 text-sm">
        {templates.map((t) => (
          <li key={t.id} className="flex items-center justify-between rounded border bg-white px-3 py-2">
            <span>
              {t.name} <span className="text-xs text-gray-400">· {t.category}</span>
            </span>
            <span className="text-xs">
              <StatusBadge status={t.status} />
              {t.rejectionReason && <span className="ml-2 text-red-600">{t.rejectionReason}</span>}
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
