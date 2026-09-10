"use client";

import { useCallback, useEffect, useState } from "react";
import { Nav } from "@/components/nav";
import { callTool, decodeTeamId } from "@/lib/api";

type TriggerType = "APPOINTMENT_REMINDER" | "POST_VISIT_FOLLOWUP" | "INACTIVE_CUSTOMER_WINBACK" | "NEW_CONTACT_WELCOME";

interface TemplateOutput {
  id: string;
  name: string;
  status: string;
}
interface AutomationOutput {
  id: string;
  name: string | null;
  triggerType: TriggerType;
  templateId: string;
  templateName: string;
  offsetMinutes: number;
  matchCategories: string[];
  matchTags: string[];
  enabled: boolean;
  createdAt: string;
}

const TRIGGER_INFO: Record<TriggerType, { label: string; help: string; offsetLabel: string; offsetHint: string }> = {
  APPOINTMENT_REMINDER: {
    label: "Promemoria appuntamento",
    help: "Invia il messaggio un tot di minuti PRIMA dell'appuntamento in agenda.",
    offsetLabel: "Minuti prima dell'appuntamento",
    offsetHint: "Es. 1440 = un giorno prima, 120 = 2 ore prima.",
  },
  POST_VISIT_FOLLOWUP: {
    label: "Follow-up dopo la visita",
    help: "Invia il messaggio un tot di minuti DOPO che l'appuntamento è stato segnato come completato.",
    offsetLabel: "Minuti dopo la visita",
    offsetHint: "Es. 60 = un'ora dopo, 1440 = il giorno dopo.",
  },
  INACTIVE_CUSTOMER_WINBACK: {
    label: "Recupero clienti inattivi",
    help: "Invia il messaggio quando un contatto non ha attività (visite, messaggi) da un tot di minuti.",
    offsetLabel: "Minuti di inattività",
    offsetHint: "Es. 86400 = 60 giorni senza attività.",
  },
  NEW_CONTACT_WELCOME: {
    label: "Benvenuto nuovo contatto",
    help: "Invia il messaggio un tot di minuti dopo che il contatto è stato importato/aggiunto.",
    offsetLabel: "Minuti dopo l'inserimento",
    offsetHint: "Es. 5 = quasi subito dopo l'import.",
  },
};

export default function AutomationsPage() {
  const teamId = decodeTeamId();
  const [automations, setAutomations] = useState<AutomationOutput[]>([]);
  const [templates, setTemplates] = useState<TemplateOutput[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!teamId) return;
    try {
      const [a, t, contacts] = await Promise.all([
        callTool<AutomationOutput[]>("/automations/list", { teamId }),
        callTool<TemplateOutput[]>("/templates/list", { teamId }),
        callTool<{
          availableCategories: { name: string; contactCount: number }[];
          availableTags: string[];
        }>("/contacts/list", { teamId, limit: 1 }),
      ]);
      setAutomations(a ?? []);
      setTemplates(t ?? []);
      setAvailableCategories((contacts?.availableCategories ?? []).map((c) => c.name));
      setAvailableTags(contacts?.availableTags ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Caricamento fallito");
    }
  }, [teamId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggleEnabled(automation: AutomationOutput) {
    setError(null);
    try {
      await callTool("/automations/update", {
        teamId,
        automationId: automation.id,
        enabled: !automation.enabled,
      });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aggiornamento fallito");
    }
  }

  async function remove(automationId: string) {
    setError(null);
    try {
      await callTool("/automations/delete", { teamId, automationId });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eliminazione fallita");
    }
  }

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-4xl space-y-8 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Automazioni</h1>
            <p className="text-sm text-gray-500">
              Crea tutte le automazioni che ti servono: stesso meccanismo di base, ma nome, template e
              destinatari (per categoria o tag) a tua scelta.
            </p>
          </div>
          <button
            onClick={() => setShowBuilder((v) => !v)}
            className="rounded bg-brand-dark px-4 py-2 text-sm font-medium text-white"
          >
            {showBuilder ? "Chiudi" : "Nuova automazione"}
          </button>
        </div>

        {showBuilder && (
          <AutomationBuilder
            teamId={teamId}
            templates={templates}
            availableCategories={availableCategories}
            availableTags={availableTags}
            onDone={() => {
              setShowBuilder(false);
              refresh();
            }}
          />
        )}

        <section className="space-y-3">
          {automations.length === 0 && (
            <p className="rounded border bg-white p-4 text-sm text-gray-400">
              Nessuna automazione configurata. Creane una con il pulsante qui sopra.
            </p>
          )}
          {automations.map((a) => (
            <div key={a.id} className="rounded border bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{a.name || TRIGGER_INFO[a.triggerType].label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        a.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {a.enabled ? "attiva" : "disattivata"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {TRIGGER_INFO[a.triggerType].label} · template &quot;{a.templateName}&quot; ·{" "}
                    {TRIGGER_INFO[a.triggerType].offsetLabel.toLowerCase()}: {a.offsetMinutes}
                  </p>
                  {(a.matchCategories.length > 0 || a.matchTags.length > 0) && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {a.matchCategories.map((c) => (
                        <span key={c} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                          {c}
                        </span>
                      ))}
                      {a.matchTags.map((t) => (
                        <span key={t} className="rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-700">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-3 text-xs">
                  <button onClick={() => toggleEnabled(a)} className="text-gray-500 underline">
                    {a.enabled ? "disattiva" : "attiva"}
                  </button>
                  <button onClick={() => remove(a.id)} className="text-red-600 underline">
                    elimina
                  </button>
                </div>
              </div>
            </div>
          ))}
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </main>
    </div>
  );
}

function AutomationBuilder({
  teamId,
  templates,
  availableCategories,
  availableTags,
  onDone,
}: {
  teamId: string | null;
  templates: TemplateOutput[];
  availableCategories: string[];
  availableTags: string[];
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<TriggerType>("APPOINTMENT_REMINDER");
  const [templateId, setTemplateId] = useState("");
  const [offsetMinutes, setOffsetMinutes] = useState(60);
  const [matchCategories, setMatchCategories] = useState<string[]>([]);
  const [matchTags, setMatchTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const info = TRIGGER_INFO[triggerType];

  async function handleCreate() {
    if (!teamId || !templateId) return;
    setBusy(true);
    setError(null);
    try {
      await callTool("/automations", {
        teamId,
        name: name || undefined,
        triggerType,
        templateId,
        offsetMinutes,
        matchCategories,
        matchTags,
        enabled: true,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creazione fallita");
    } finally {
      setBusy(false);
    }
  }

  function toggleFrom(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  return (
    <section className="space-y-4 rounded border bg-white p-4">
      <div>
        <label className="mb-1 block text-xs uppercase text-gray-500">Nome (facoltativo)</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Es. Promemoria taglio capelli"
          className="w-full rounded border px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs uppercase text-gray-500">Trigger</label>
        <select
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value as TriggerType)}
          className="w-full rounded border px-3 py-2 text-sm"
        >
          {(Object.keys(TRIGGER_INFO) as TriggerType[]).map((t) => (
            <option key={t} value={t}>
              {TRIGGER_INFO[t].label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-400">{info.help}</p>
      </div>

      <div>
        <label className="mb-1 block text-xs uppercase text-gray-500">Template</label>
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="w-full rounded border px-3 py-2 text-sm"
        >
          <option value="">Seleziona un template…</option>
          {templates
            .filter((t) => t.status === "APPROVED" || t.status === "DRAFT")
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs uppercase text-gray-500">{info.offsetLabel}</label>
        <input
          type="number"
          value={offsetMinutes}
          onChange={(e) => setOffsetMinutes(Number(e.target.value))}
          className="w-full rounded border px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-gray-400">{info.offsetHint}</p>
      </div>

      {availableCategories.length > 0 && (
        <div>
          <span className="mb-1 block text-xs uppercase text-gray-500">
            Solo per categorie (facoltativo — vuoto = tutti)
          </span>
          <div className="flex flex-wrap gap-2">
            {availableCategories.map((cat) => {
              const active = matchCategories.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleFrom(matchCategories, setMatchCategories, cat)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    active ? "border-brand-dark bg-green-50 text-brand-dark" : "text-gray-600"
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {availableTags.length > 0 && (
        <div>
          <span className="mb-1 block text-xs uppercase text-gray-500">
            Solo per tag (facoltativo — vuoto = tutti)
          </span>
          <div className="flex flex-wrap gap-2">
            {availableTags.map((tag) => {
              const active = matchTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleFrom(matchTags, setMatchTags, tag)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    active ? "border-brand-dark bg-green-50 text-brand-dark" : "text-gray-600"
                  }`}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        onClick={handleCreate}
        disabled={busy || !templateId}
        className="rounded bg-brand-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {busy ? "Creazione…" : "Crea automazione"}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
