"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Nav } from "@/components/nav";
import { callTool, decodeTeamId } from "@/lib/api";

interface ContactOutput {
  id: string;
  phoneE164: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  tags: string[];
  categories: string[];
  customFields: Record<string, string>;
  createdAt: string;
}
interface ConversationSummary {
  id: string;
  lastMessagePreview: string;
  lastMessageAt: string;
  messageCount: number;
  closedAt: string | null;
}
interface CampaignSummary {
  campaignId: string;
  name: string;
  status: string;
  sentAt: string | null;
  messageStatus: string | null;
}
interface PossibleDuplicate {
  id: string;
  phoneE164: string;
  name: string | null;
  reason: string;
}
interface ContactDetail {
  contact: ContactOutput;
  conversations: ConversationSummary[];
  campaigns: CampaignSummary[];
  possibleDuplicates: PossibleDuplicate[];
}

export default function ContactDetailPage() {
  const teamId = decodeTeamId();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<ContactOutput>>({});
  const [customFieldsText, setCustomFieldsText] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [categoriesText, setCategoriesText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!teamId || !params.id) return;
    try {
      const result = await callTool<ContactDetail>("/contacts/get", { teamId, contactId: params.id });
      setDetail(result);
      setForm(result.contact);
      setTagsText(result.contact.tags.join(", "));
      setCategoriesText(result.contact.categories.join(", "));
      setCustomFieldsText(
        Object.entries(result.contact.customFields)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n"),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Contatto non trovato");
    }
  }, [teamId, params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const customFields: Record<string, string> = {};
      for (const line of customFieldsText.split("\n")) {
        const [key, ...rest] = line.split(":");
        if (key && key.trim() && rest.length > 0) customFields[key.trim()] = rest.join(":").trim();
      }

      await callTool("/contacts/update", {
        teamId,
        contactId: params.id,
        phoneE164: form.phoneE164,
        firstName: form.firstName || null,
        lastName: form.lastName || null,
        email: form.email || null,
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
        categories: categoriesText.split(",").map((c) => c.trim()).filter(Boolean),
        customFields,
      });
      setEditing(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Salvataggio fallito");
    } finally {
      setBusy(false);
    }
  }

  async function handleMerge(duplicateId: string) {
    if (!confirm("Fondere questo contatto duplicato in questo? L'operazione non si può annullare.")) return;
    setBusy(true);
    setError(null);
    try {
      await callTool("/contacts/merge", { teamId, keepContactId: params.id, mergeContactIds: [duplicateId] });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fusione fallita");
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <div>
        <Nav />
        <main className="mx-auto max-w-3xl p-6">
          {error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-gray-400">Caricamento…</p>}
        </main>
      </div>
    );
  }

  const { contact } = detail;

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <button onClick={() => router.push("/contacts")} className="text-sm text-gray-500 underline">
          ← torna ai contatti
        </button>

        <div className="rounded border bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h1 className="text-lg font-semibold">
              {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.phoneE164}
            </h1>
            <button onClick={() => setEditing((v) => !v)} className="text-sm text-brand-dark underline">
              {editing ? "annulla" : "modifica"}
            </button>
          </div>

          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Telefono">
                  <input
                    value={form.phoneE164 ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, phoneE164: e.target.value }))}
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Email">
                  <input
                    value={form.email ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Nome">
                  <input
                    value={form.firstName ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Cognome">
                  <input
                    value={form.lastName ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Tag (separati da virgola)">
                  <input
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Categorie (separate da virgola)">
                  <input
                    value={categoriesText}
                    onChange={(e) => setCategoriesText(e.target.value)}
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </Field>
              </div>
              <Field label="Campi personalizzati (uno per riga, chiave: valore)">
                <textarea
                  value={customFieldsText}
                  onChange={(e) => setCustomFieldsText(e.target.value)}
                  className="h-24 w-full rounded border px-2 py-1.5 text-sm"
                />
              </Field>
              <button
                onClick={handleSave}
                disabled={busy}
                className="rounded bg-brand-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Salva
              </button>
            </div>
          ) : (
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Row label="Telefono" value={contact.phoneE164} mono />
              <Row label="Email" value={contact.email ?? "—"} />
              <Row
                label="Tag"
                value={contact.tags.length ? contact.tags.join(", ") : "—"}
              />
              <Row
                label="Categorie"
                value={contact.categories.length ? contact.categories.join(", ") : "—"}
              />
              <Row label="Cliente da" value={new Date(contact.createdAt).toLocaleDateString("it-IT")} />
              {Object.entries(contact.customFields).map(([k, v]) => (
                <Row key={k} label={k} value={v} />
              ))}
            </dl>
          )}
        </div>

        {detail.possibleDuplicates.length > 0 && (
          <div className="rounded border border-amber-200 bg-amber-50 p-4">
            <h2 className="mb-2 text-sm font-semibold text-amber-900">Possibili duplicati</h2>
            <ul className="space-y-2">
              {detail.possibleDuplicates.map((d) => (
                <li key={d.id} className="flex items-center justify-between text-sm">
                  <span>
                    {d.name ?? d.phoneE164} <span className="text-xs text-amber-700">({d.reason})</span>
                  </span>
                  <button
                    onClick={() => handleMerge(d.id)}
                    disabled={busy}
                    className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
                  >
                    fondi in questo
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded border bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold">Conversazioni</h2>
          {detail.conversations.length === 0 ? (
            <p className="text-sm text-gray-400">Nessuna conversazione.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {detail.conversations.map((c) => (
                <li key={c.id} className="rounded border px-3 py-2">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{c.messageCount} messaggi</span>
                    <span>{new Date(c.lastMessageAt).toLocaleString("it-IT")}</span>
                  </div>
                  <p className="mt-0.5 truncate">{c.lastMessagePreview}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded border bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold">Campagne ricevute</h2>
          {detail.campaigns.length === 0 ? (
            <p className="text-sm text-gray-400">Nessuna campagna ricevuta finora.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {detail.campaigns.map((c, i) => (
                <li key={`${c.campaignId}-${i}`} className="flex justify-between rounded border px-3 py-2">
                  <span>{c.name}</span>
                  <span className="text-xs text-gray-500">
                    {c.messageStatus} · {c.sentAt ? new Date(c.sentAt).toLocaleDateString("it-IT") : c.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-gray-600">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className={`mt-0.5 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
