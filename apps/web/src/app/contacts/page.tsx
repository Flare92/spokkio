"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Nav } from "@/components/nav";
import { callTool, decodeTeamId } from "@/lib/api";
import {
  CONTACT_FIELDS,
  type ColumnMapping,
  type ContactFieldKey,
  type ParsedFile,
  normalizeRows,
  parseFile,
  slugifyKey,
} from "@/lib/import";

interface ContactRow {
  id: string;
  phoneE164: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  tags: string[];
  customFields: Record<string, string>;
}

interface ListContactsResponse {
  contacts: ContactRow[];
  total: number;
  availableCustomFields: string[];
  availableTags: string[];
}

interface SegmentOutput {
  id: string;
  name: string;
  matchTags: string[];
  matchMode: "ANY" | "ALL";
  contactCount: number;
}

const IMPORT_BATCH_SIZE = 200;

export default function ContactsPage() {
  const teamId = decodeTeamId();
  const [list, setList] = useState<ListContactsResponse | null>(null);
  const [search, setSearch] = useState("");
  const [segments, setSegments] = useState<SegmentOutput[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    if (!teamId) return;
    try {
      const result = await callTool<ListContactsResponse>("/contacts/list", {
        teamId,
        search: search || undefined,
        limit: 100,
      });
      setList(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile caricare i contatti");
    }
  }, [teamId, search]);

  const loadSegments = useCallback(async () => {
    if (!teamId) return;
    try {
      setSegments(await callTool<SegmentOutput[]>("/contacts/segments/list", { teamId }));
    } catch {
      /* la lista segmenti non è critica per questa pagina */
    }
  }, [teamId]);

  useEffect(() => {
    loadContacts();
    loadSegments();
  }, [loadContacts, loadSegments]);

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-5xl space-y-10 p-6">
        <FileImportSection
          teamId={teamId}
          onImported={() => {
            loadContacts();
            loadSegments();
          }}
        />

        <ContactsTable
          list={list}
          search={search}
          onSearchChange={setSearch}
        />

        <SegmentsSection
          teamId={teamId}
          segments={segments}
          availableTags={list?.availableTags ?? []}
          onCreated={loadSegments}
        />

        {error && <p className="text-sm text-red-600">{error}</p>}
      </main>
    </div>
  );
}

function FileImportSection({ teamId, onImported }: { teamId: string | null; onImported: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({ fields: {}, customColumns: [] });
  const [countryCode, setCountryCode] = useState("+39");
  const [extraTags, setExtraTags] = useState("");
  const [updateExisting, setUpdateExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      const data = await parseFile(file);
      if (data.rows.length === 0) {
        setError("Il file non contiene righe leggibili.");
        return;
      }
      setParsed(data);
      setFileName(file.name);
      setMapping({ fields: guessMapping(data.headers), customColumns: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile leggere il file");
    }
  }

  const preview = useMemo(() => {
    if (!parsed) return null;
    return normalizeRows(parsed.rows, mapping, {
      defaultCountryCode: countryCode,
      extraTags: extraTags.split(",").map((t) => t.trim()).filter(Boolean),
    });
  }, [parsed, mapping, countryCode, extraTags]);

  async function handleImport() {
    if (!parsed || !preview || preview.valid.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let imported = 0;
      let updated = 0;
      let skipped = 0;

      // File grandi vengono spezzati in blocchi: una richiesta unica da
      // migliaia di righe rischia timeout e non dà nessun avanzamento.
      for (let i = 0; i < preview.valid.length; i += IMPORT_BATCH_SIZE) {
        const batch = preview.valid.slice(i, i + IMPORT_BATCH_SIZE);
        const res = await callTool<{ imported: number; updated: number; skippedDuplicates: number }>(
          "/contacts/import",
          {
            teamId,
            source: /\.(xlsx|xls)$/i.test(fileName) ? "XLSX" : "CSV",
            updateExisting,
            rows: batch,
          },
        );
        imported += res.imported;
        updated += res.updated;
        skipped += res.skippedDuplicates;
        setResult(`Importazione in corso... ${i + batch.length}/${preview.valid.length}`);
      }

      setResult(
        `Fatto: ${imported} nuovi, ${updated} aggiornati, ${skipped} già presenti (saltati)` +
          (preview.invalid.length > 0 ? `, ${preview.invalid.length} righe scartate` : ""),
      );
      setParsed(null);
      setFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import fallito");
    } finally {
      setBusy(false);
    }
  }

  const unmappedColumns = parsed
    ? parsed.headers.filter((h) => !Object.values(mapping.fields).includes(h))
    : [];

  return (
    <section>
      <h1 className="mb-1 text-lg font-semibold">Importa contatti</h1>
      <p className="mb-4 text-sm text-gray-500">
        Carica un file CSV o Excel (.xlsx). Le colonne che non mappi sui campi standard puoi tenerle come
        campi personalizzati, e usarle come variabili nelle campagne.
      </p>

      <div className="rounded border bg-white p-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls"
          onChange={handleFile}
          className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-brand-dark file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
        />

        {parsed && (
          <div className="mt-5 space-y-5">
            <div className="text-sm text-gray-600">
              <span className="font-medium">{fileName}</span> — {parsed.rows.length} righe, {parsed.headers.length}{" "}
              colonne
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">1. Mappa le colonne</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {CONTACT_FIELDS.map((field) => (
                  <label key={field.key} className="flex items-center gap-2 text-sm">
                    <span className="w-48 shrink-0 text-gray-600">{field.label}</span>
                    <select
                      value={mapping.fields[field.key] ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({
                          ...m,
                          fields: { ...m.fields, [field.key]: e.target.value || undefined },
                          customColumns: m.customColumns.filter((c) => c !== e.target.value),
                        }))
                      }
                      className="flex-1 rounded border px-2 py-1 text-sm"
                    >
                      <option value="">— non importare —</option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            {unmappedColumns.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">2. Colonne extra da tenere come variabili</h3>
                <div className="flex flex-wrap gap-2">
                  {unmappedColumns.map((column) => {
                    const active = mapping.customColumns.includes(column);
                    return (
                      <button
                        key={column}
                        type="button"
                        onClick={() =>
                          setMapping((m) => ({
                            ...m,
                            customColumns: active
                              ? m.customColumns.filter((c) => c !== column)
                              : [...m.customColumns, column],
                          }))
                        }
                        className={`rounded-full border px-3 py-1 text-xs ${
                          active ? "border-brand-dark bg-green-50 text-brand-dark" : "text-gray-600"
                        }`}
                      >
                        {column}
                        {active && <span className="ml-1 text-gray-400">→ {slugifyKey(column)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <h3 className="mb-2 text-sm font-semibold">3. Opzioni</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="text-sm">
                  <span className="mb-1 block text-gray-600">Prefisso per numeri senza +</span>
                  <input
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="w-full rounded border px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-gray-600">Tag da aggiungere a tutti</span>
                  <input
                    value={extraTags}
                    onChange={(e) => setExtraTags(e.target.value)}
                    placeholder="es. import_settembre"
                    className="w-full rounded border px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex items-end gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={updateExisting}
                    onChange={(e) => setUpdateExisting(e.target.checked)}
                    className="mb-2"
                  />
                  <span className="mb-1 text-gray-600">Aggiorna i contatti già esistenti</span>
                </label>
              </div>
            </div>

            {preview && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">4. Anteprima</h3>
                <p className="mb-2 text-sm">
                  <span className="font-medium text-green-700">{preview.valid.length} contatti validi</span>
                  {preview.invalid.length > 0 && (
                    <span className="text-red-600"> · {preview.invalid.length} righe scartate</span>
                  )}
                </p>

                {preview.valid.length > 0 && (
                  <div className="overflow-x-auto rounded border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          <th className="px-2 py-1">Telefono</th>
                          <th className="px-2 py-1">Nome</th>
                          <th className="px-2 py-1">Tag</th>
                          <th className="px-2 py-1">Campi personalizzati</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.valid.slice(0, 5).map((row, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-2 py-1 font-mono">{row.phoneE164}</td>
                            <td className="px-2 py-1">{[row.firstName, row.lastName].filter(Boolean).join(" ")}</td>
                            <td className="px-2 py-1">{row.tags.join(", ")}</td>
                            <td className="px-2 py-1 text-gray-500">
                              {Object.entries(row.customFields)
                                .map(([k, v]) => `${k}=${v}`)
                                .join(" · ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {preview.invalid.length > 0 && (
                  <details className="mt-2 text-xs text-gray-600">
                    <summary className="cursor-pointer">Vedi righe scartate ({preview.invalid.length})</summary>
                    <ul className="mt-1 space-y-0.5">
                      {preview.invalid.slice(0, 20).map((r, i) => (
                        <li key={i}>
                          Riga {r.row}: {r.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            <button
              onClick={handleImport}
              disabled={busy || !preview || preview.valid.length === 0}
              className="rounded bg-brand-dark px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy ? "Importazione..." : `Importa ${preview?.valid.length ?? 0} contatti`}
            </button>
          </div>
        )}

        {result && <p className="mt-3 text-sm text-green-700">{result}</p>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    </section>
  );
}

function ContactsTable({
  list,
  search,
  onSearchChange,
}: {
  list: ListContactsResponse | null;
  search: string;
  onSearchChange: (v: string) => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Contatti {list ? <span className="text-sm font-normal text-gray-500">({list.total})</span> : null}
        </h2>
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Cerca nome, numero, email..."
          className="w-64 rounded border px-3 py-1.5 text-sm"
        />
      </div>

      {list && list.availableCustomFields.length > 0 && (
        <p className="mb-2 text-xs text-gray-500">
          Variabili disponibili per le campagne:{" "}
          {list.availableCustomFields.map((f) => (
            <code key={f} className="mr-1 rounded bg-gray-100 px-1">
              {f}
            </code>
          ))}
        </p>
      )}

      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Telefono</th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Tag</th>
            </tr>
          </thead>
          <tbody>
            {(list?.contacts ?? []).map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{c.phoneE164}</td>
                <td className="px-3 py-2">{[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}</td>
                <td className="px-3 py-2 text-gray-600">{c.email ?? "—"}</td>
                <td className="px-3 py-2">
                  {c.tags.map((t) => (
                    <span key={t} className="mr-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                      {t}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
            {list && list.contacts.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">
                  Nessun contatto. Importa un file per iniziare.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SegmentsSection({
  teamId,
  segments,
  availableTags,
  onCreated,
}: {
  teamId: string | null;
  segments: SegmentOutput[];
  availableTags: string[];
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [matchMode, setMatchMode] = useState<"ANY" | "ALL">("ANY");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await callTool("/contacts/segments", { teamId, name, matchTags: selectedTags, matchMode });
      setName("");
      setSelectedTags([]);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creazione segmento fallita");
    }
  }

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Segmenti</h2>
      <p className="mb-3 text-sm text-gray-500">
        Un segmento è una regola sui tag, sempre visibile e verificabile: nessuna selezione a scatola nera.
      </p>

      <form onSubmit={handleCreate} className="space-y-3 rounded border bg-white p-4">
        <div className="flex gap-3">
          <input
            required
            placeholder="Nome segmento"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded border px-3 py-2 text-sm"
          />
          <select
            value={matchMode}
            onChange={(e) => setMatchMode(e.target.value as "ANY" | "ALL")}
            className="rounded border px-3 py-2 text-sm"
          >
            <option value="ANY">almeno uno dei tag</option>
            <option value="ALL">tutti i tag</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          {availableTags.length === 0 && (
            <span className="text-sm text-gray-400">Nessun tag disponibile: importa dei contatti con tag.</span>
          )}
          {availableTags.map((tag) => {
            const active = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() =>
                  setSelectedTags((prev) => (active ? prev.filter((t) => t !== tag) : [...prev, tag]))
                }
                className={`rounded-full border px-3 py-1 text-xs ${
                  active ? "border-brand-dark bg-green-50 text-brand-dark" : "text-gray-600"
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>

        <button
          type="submit"
          disabled={selectedTags.length === 0}
          className="rounded bg-brand-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Crea segmento
        </button>
      </form>

      {segments.length > 0 && (
        <ul className="mt-3 space-y-2">
          {segments.map((s) => (
            <li key={s.id} className="rounded border bg-white p-3 text-sm">
              <span className="font-medium">{s.name}</span> — {s.contactCount} contatti
              <span className="text-gray-500">
                {" "}
                ({s.matchMode === "ANY" ? "almeno uno di" : "tutti"}: {s.matchTags.join(", ")})
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

// Prova a indovinare la mappatura dalle intestazioni più comuni, così nel caso
// tipico l'utente deve solo confermare.
function guessMapping(headers: string[]): Partial<Record<ContactFieldKey, string>> {
  const find = (candidates: string[]) =>
    headers.find((h) => candidates.some((c) => h.toLowerCase().replace(/[\s_-]/g, "").includes(c)));

  return {
    phoneE164: find(["telefono", "phone", "cellulare", "mobile", "numero", "whatsapp"]),
    firstName: find(["nome", "firstname", "name"]),
    lastName: find(["cognome", "lastname", "surname"]),
    email: find(["email", "mail"]),
    tags: find(["tag", "etichett", "categoria"]),
  };
}
