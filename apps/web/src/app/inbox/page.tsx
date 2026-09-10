"use client";

import { useCallback, useEffect, useState } from "react";
import { Nav } from "@/components/nav";
import { callTool, decodeTeamId, decodeUserId } from "@/lib/api";

const POLL_MS = 5000; // no push infrastructure yet: short-interval polling stands in for real-time

interface ConversationSummary {
  id: string;
  contactId: string;
  contactName: string | null;
  contactPhone: string;
  lastMessagePreview: string;
  lastMessageAt: string;
  unread: boolean;
  assignedOperatorId: string | null;
  assignedOperatorEmail: string | null;
  labels: string[];
}
interface MessageOutput {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  text: string;
  status: string;
  createdAt: string;
}
interface ConversationDetail {
  id: string;
  contactId: string;
  contactName: string | null;
  contactPhone: string;
  assignedOperatorId: string | null;
  labels: string[];
  messages: MessageOutput[];
}
interface OperatorOutput {
  id: string;
  email: string;
  role: string;
}
interface CannedResponseOutput {
  id: string;
  shortcut: string;
  text: string;
}

export default function InboxPage() {
  const teamId = decodeTeamId();
  const userId = decodeUserId();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [operators, setOperators] = useState<OperatorOutput[]>([]);
  const [canned, setCanned] = useState<CannedResponseOutput[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [labelFilter, setLabelFilter] = useState("");
  const [showCannedManager, setShowCannedManager] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    if (!teamId) return;
    try {
      const list = await callTool<ConversationSummary[]>("/inbox/conversations/list", {
        teamId,
        status: "OPEN",
        search: search || undefined,
        label: labelFilter || undefined,
        onlyUnassigned,
      });
      setConversations(list ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile caricare l'inbox");
    }
  }, [teamId, search, labelFilter, onlyUnassigned]);

  const loadDetail = useCallback(
    async (conversationId: string) => {
      if (!teamId) return;
      try {
        const d = await callTool<ConversationDetail>("/inbox/conversations/get", { teamId, conversationId });
        setDetail(d);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Impossibile caricare la conversazione");
      }
    },
    [teamId],
  );

  useEffect(() => {
    if (!teamId) return;
    callTool<OperatorOutput[]>("/inbox/operators/list", { teamId }).then(setOperators).catch(() => {});
    callTool<CannedResponseOutput[]>("/inbox/canned-responses/list", { teamId }).then(setCanned).catch(() => {});
  }, [teamId]);

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, POLL_MS);
    return () => clearInterval(interval);
  }, [loadConversations]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    loadDetail(selected);
    const interval = setInterval(() => loadDetail(selected), POLL_MS);
    return () => clearInterval(interval);
  }, [selected, loadDetail]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !text.trim()) return;
    setError(null);
    try {
      await callTool("/inbox/messages/send", {
        teamId,
        conversationId: selected,
        operatorId: userId,
        text,
      });
      setText("");
      loadDetail(selected);
      loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invio messaggio fallito");
    }
  }

  async function handleAssign(conversationId: string, operatorId: string) {
    setError(null);
    try {
      await callTool("/inbox/conversations/assign", {
        teamId,
        conversationId,
        operatorId: operatorId || null,
      });
      loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assegnazione fallita");
    }
  }

  async function handleSetLabels(conversationId: string, labels: string[]) {
    setError(null);
    try {
      await callTool("/inbox/conversations/labels", { teamId, conversationId, labels });
      loadConversations();
      if (selected === conversationId) loadDetail(conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aggiornamento etichette fallito");
    }
  }

  const allLabels = Array.from(new Set(conversations.flatMap((c) => c.labels))).sort();

  return (
    <div>
      <Nav />
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-4 p-6 sm:grid-cols-3">
        <div className="sm:col-span-1 space-y-3">
          <h1 className="text-lg font-semibold">Conversazioni</h1>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca nome, telefono o testo…"
            className="w-full rounded border px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
              solo non assegnate
            </label>
          </div>
          {allLabels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setLabelFilter("")}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  labelFilter === "" ? "border-brand-dark bg-green-50 text-brand-dark" : "text-gray-600"
                }`}
              >
                tutte
              </button>
              {allLabels.map((l) => (
                <button
                  key={l}
                  onClick={() => setLabelFilter(l)}
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    labelFilter === l ? "border-brand-dark bg-green-50 text-brand-dark" : "text-gray-600"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          )}
          <ul className="space-y-1">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setSelected(c.id)}
                  className={`w-full rounded border p-2 text-left text-sm ${
                    selected === c.id ? "border-brand-dark bg-green-50" : "bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.contactName ?? c.contactPhone}</span>
                    {c.unread && <span className="h-2 w-2 rounded-full bg-brand-dark" />}
                  </div>
                  <div className="truncate text-gray-500">{c.lastMessagePreview}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {c.assignedOperatorEmail && (
                      <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                        {c.assignedOperatorEmail}
                      </span>
                    )}
                    {c.labels.map((l) => (
                      <span key={l} className="rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-700">
                        {l}
                      </span>
                    ))}
                  </div>
                </button>
              </li>
            ))}
            {conversations.length === 0 && <p className="text-sm text-gray-400">Nessuna conversazione trovata.</p>}
          </ul>
        </div>
        <div className="sm:col-span-2 space-y-3">
          {detail ? (
            <>
              <div className="rounded border bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{detail.contactName ?? detail.contactPhone}</div>
                    <div className="text-xs text-gray-500">{detail.contactPhone}</div>
                  </div>
                  <select
                    value={detail.assignedOperatorId ?? ""}
                    onChange={(e) => handleAssign(detail.id, e.target.value)}
                    className="rounded border px-2 py-1 text-xs"
                  >
                    <option value="">Non assegnata</option>
                    {operators.map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.email}
                      </option>
                    ))}
                  </select>
                </div>
                <LabelEditor
                  labels={detail.labels}
                  onChange={(labels) => handleSetLabels(detail.id, labels)}
                />
              </div>

              <div className="h-72 space-y-2 overflow-y-auto rounded border bg-white p-3">
                {detail.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[75%] rounded px-3 py-2 text-sm ${
                        m.direction === "OUTBOUND" ? "bg-brand-dark text-white" : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.text}</p>
                      <p className={`mt-1 text-[10px] ${m.direction === "OUTBOUND" ? "text-white/70" : "text-gray-400"}`}>
                        {new Date(m.createdAt).toLocaleString("it-IT")}
                        {m.direction === "OUTBOUND" ? ` · ${m.status.toLowerCase()}` : ""}
                      </p>
                    </div>
                  </div>
                ))}
                {detail.messages.length === 0 && <p className="text-sm text-gray-400">Nessun messaggio.</p>}
              </div>

              <form onSubmit={handleSend} className="space-y-2 rounded border bg-white p-4">
                {canned.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {canned.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setText((prev) => (prev ? `${prev} ${c.text}` : c.text))}
                        className="rounded-full border px-2 py-0.5 text-xs text-gray-600"
                        title={c.text}
                      >
                        /{c.shortcut}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  required
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Scrivi una risposta..."
                  className="h-24 w-full rounded border px-3 py-2 text-sm"
                />
                <div className="flex items-center justify-between">
                  <button type="submit" className="rounded bg-brand-dark px-4 py-2 text-sm font-medium text-white">
                    Invia
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCannedManager((v) => !v)}
                    className="text-xs text-gray-500 underline"
                  >
                    gestisci risposte rapide
                  </button>
                </div>
                <p className="text-xs text-gray-400">
                  I messaggi liberi sono consegnabili solo entro 24h dall&apos;ultimo messaggio del cliente.
                </p>
              </form>
            </>
          ) : (
            <p className="text-sm text-gray-400">Seleziona una conversazione per rispondere.</p>
          )}

          {showCannedManager && (
            <CannedResponseManager
              teamId={teamId}
              responses={canned}
              onChanged={() =>
                teamId && callTool<CannedResponseOutput[]>("/inbox/canned-responses/list", { teamId }).then(setCanned)
              }
            />
          )}
        </div>
        {error && <p className="col-span-full text-sm text-red-600">{error}</p>}
      </main>
    </div>
  );
}

function LabelEditor({ labels, onChange }: { labels: string[]; onChange: (labels: string[]) => void }) {
  const [draft, setDraft] = useState("");

  function add() {
    const value = draft.trim();
    if (!value || labels.includes(value)) return;
    onChange([...labels, value]);
    setDraft("");
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {labels.map((l) => (
        <span key={l} className="flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-700">
          {l}
          <button onClick={() => onChange(labels.filter((x) => x !== l))} className="text-purple-400">
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder="+ etichetta"
        className="w-24 rounded border px-2 py-0.5 text-xs"
      />
    </div>
  );
}

function CannedResponseManager({
  teamId,
  responses,
  onChanged,
}: {
  teamId: string | null;
  responses: CannedResponseOutput[];
  onChanged: () => void;
}) {
  const [shortcut, setShortcut] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!teamId || !shortcut.trim() || !text.trim()) return;
    setError(null);
    try {
      await callTool("/inbox/canned-responses/create", { teamId, shortcut: shortcut.trim(), text: text.trim() });
      setShortcut("");
      setText("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creazione fallita");
    }
  }

  async function remove(cannedResponseId: string) {
    setError(null);
    try {
      await callTool("/inbox/canned-responses/delete", { teamId, cannedResponseId });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eliminazione fallita");
    }
  }

  return (
    <div className="space-y-3 rounded border bg-white p-4">
      <h2 className="text-sm font-semibold">Risposte rapide</h2>
      <div className="space-y-2">
        {responses.map((r) => (
          <div key={r.id} className="flex items-start justify-between gap-2 rounded border px-2 py-1 text-sm">
            <div>
              <span className="font-medium">/{r.shortcut}</span>
              <p className="text-xs text-gray-500">{r.text}</p>
            </div>
            <button onClick={() => remove(r.id)} className="text-xs text-red-600 underline">
              elimina
            </button>
          </div>
        ))}
        {responses.length === 0 && <p className="text-xs text-gray-400">Nessuna risposta rapida configurata.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={shortcut}
          onChange={(e) => setShortcut(e.target.value)}
          placeholder="shortcut (es. grazie)"
          className="w-40 rounded border px-2 py-1 text-sm"
        />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Testo completo"
          className="min-w-[16rem] flex-1 rounded border px-2 py-1 text-sm"
        />
        <button onClick={create} className="rounded border px-3 py-1 text-sm">
          Aggiungi
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
