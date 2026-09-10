"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { callTool, decodeTeamId } from "@/lib/api";
import {
  CONTACT_FIELDS,
  type ColumnMapping,
  type ContactFieldKey,
  type NormalizedRow,
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
  categories: string[];
  customFields: Record<string, string>;
}

interface CategoryFacet {
  name: string;
  contactCount: number;
}

interface ListContactsResponse {
  contacts: ContactRow[];
  total: number;
  availableCustomFields: string[];
  availableTags: string[];
  availableCategories: CategoryFacet[];
}

interface SegmentOutput {
  id: string;
  name: string;
  matchTags: string[];
  matchCategories: string[];
  matchMode: "ANY" | "ALL";
  contactCount: number;
}

const IMPORT_BATCH_SIZE = 200;
const MAX_REVIEW_ROWS_RENDERED = 300;

export default function ContactsPage() {
  const teamId = decodeTeamId();
  const [list, setList] = useState<ListContactsResponse | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [segments, setSegments] = useState<SegmentOutput[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    if (!teamId) return;
    try {
      const result = await callTool<ListContactsResponse>("/contacts/list", {
        teamId,
        search: search || undefined,
        category: categoryFilter || undefined,
        limit: 200,
      });
      // Gli elenchi vengono normalizzati qui, all'ingresso: se l'API in
      // esecuzione è più vecchia del frontend (capita durante un
      // aggiornamento, con un processo rimasto attivo dalla versione
      // precedente) un campo assente non deve far collassare la pagina.
      setList({
        ...result,
        contacts: (result.contacts ?? []).map((c) => ({
          ...c,
          tags: c.tags ?? [],
          categories: c.categories ?? [],
          customFields: c.customFields ?? {},
        })),
        availableCustomFields: result.availableCustomFields ?? [],
        availableTags: result.availableTags ?? [],
        availableCategories: result.availableCategories ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile caricare i contatti");
    }
  }, [teamId, search, categoryFilter]);

  const loadSegments = useCallback(async () => {
    if (!teamId) return;
    try {
      const result = await callTool<SegmentOutput[]>("/contacts/segments/list", { teamId });
      setSegments(
        (result ?? []).map((s) => ({
          ...s,
          matchTags: s.matchTags ?? [],
          matchCategories: s.matchCategories ?? [],
        })),
      );
    } catch {
      /* la lista segmenti non è critica per questa pagina */
    }
  }, [teamId]);

  const refreshAll = useCallback(() => {
    loadContacts();
    loadSegments();
  }, [loadContacts, loadSegments]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const knownCategories = (list?.availableCategories ?? []).map((c) => c.name);

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-6xl space-y-10 p-6">
        <FileImportSection teamId={teamId} knownCategories={knownCategories} onImported={refreshAll} />

        <CategoriesOverview
          categories={list?.availableCategories ?? []}
          activeCategory={categoryFilter}
          onFilter={setCategoryFilter}
        />

        <ContactsTable
          teamId={teamId}
          list={list}
          search={search}
          onSearchChange={setSearch}
          knownCategories={knownCategories}
          onChanged={refreshAll}
        />

        <DuplicatesSection teamId={teamId} onChanged={refreshAll} />

        <SegmentsSection
          teamId={teamId}
          segments={segments}
          availableTags={list?.availableTags ?? []}
          availableCategories={knownCategories}
          onCreated={loadSegments}
        />

        {error && <p className="text-sm text-red-600">{error}</p>}
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------- import */

interface ReviewRow extends NormalizedRow {
  rowKey: string;
}

function FileImportSection({
  teamId,
  knownCategories,
  onImported,
}: {
  teamId: string | null;
  knownCategories: string[];
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({ fields: {}, customColumns: [] });
  const [countryCode, setCountryCode] = useState("+39");
  const [extraTags, setExtraTags] = useState("");
  const [updateExisting, setUpdateExisting] = useState(true);

  // Righe in revisione: qui l'utente assegna le categorie prima di importare.
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [invalid, setInvalid] = useState<{ row: number; reason: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");

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
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile leggere il file");
    }
  }

  // Ogni volta che cambia la mappatura, le righe in revisione vengono
  // ricalcolate; le categorie già assegnate a un numero si conservano, così
  // non si perde il lavoro fatto se si corregge una colonna.
  const normalized = useMemo(() => {
    if (!parsed) return null;
    return normalizeRows(parsed.rows, mapping, {
      defaultCountryCode: countryCode,
      extraTags: extraTags.split(",").map((t) => t.trim()).filter(Boolean),
    });
  }, [parsed, mapping, countryCode, extraTags]);

  useEffect(() => {
    if (!normalized) {
      setRows([]);
      setInvalid([]);
      return;
    }
    setRows((previous) => {
      const previousCategories = new Map(previous.map((r) => [r.phoneE164, r.categories]));
      return normalized.valid.map((row, index) => ({
        ...row,
        categories: previousCategories.get(row.phoneE164) ?? row.categories,
        rowKey: `${row.phoneE164}-${index}`,
      }));
    });
    setInvalid(normalized.invalid);
  }, [normalized]);

  function assignCategoryTo(rowKeys: Set<string> | "all", rawCategory: string) {
    const category = rawCategory.trim();
    if (!category) return;
    setRows((prev) =>
      prev.map((row) =>
        rowKeys === "all" || rowKeys.has(row.rowKey)
          ? { ...row, categories: Array.from(new Set([...row.categories, category])) }
          : row,
      ),
    );
  }

  function setRowCategories(rowKey: string, value: string) {
    const categories = value
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    setRows((prev) => prev.map((row) => (row.rowKey === rowKey ? { ...row, categories } : row)));
  }

  function clearAllCategories() {
    setRows((prev) => prev.map((row) => ({ ...row, categories: [] })));
  }

  async function handleImport() {
    if (rows.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let imported = 0;
      let updated = 0;
      let skipped = 0;

      // File grandi vengono spezzati in blocchi: una richiesta unica da
      // migliaia di righe rischia timeout e non dà nessun avanzamento.
      for (let i = 0; i < rows.length; i += IMPORT_BATCH_SIZE) {
        const batch = rows.slice(i, i + IMPORT_BATCH_SIZE).map(({ rowKey, ...row }) => row);
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
        setResult(`Importazione in corso... ${Math.min(i + IMPORT_BATCH_SIZE, rows.length)}/${rows.length}`);
      }

      setResult(
        `Fatto: ${imported} nuovi, ${updated} aggiornati, ${skipped} già presenti (saltati)` +
          (invalid.length > 0 ? `, ${invalid.length} righe scartate` : ""),
      );
      setParsed(null);
      setRows([]);
      setSelected(new Set());
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
  const withoutCategory = rows.filter((r) => r.categories.length === 0).length;
  const categoriesInFile = Array.from(new Set(rows.flatMap((r) => r.categories))).sort();

  return (
    <section>
      <h1 className="mb-1 text-lg font-semibold">Importa contatti</h1>
      <p className="mb-4 text-sm text-gray-500">
        Carica un CSV o un Excel, mappa le colonne e assegna le categorie: sono i gruppi che ti verranno
        proposti come destinatari quando crei una campagna.
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
          <div className="mt-5 space-y-6">
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

            <div>
              <h3 className="mb-1 text-sm font-semibold">4. Categorie</h3>
              <p className="mb-3 text-xs text-gray-500">
                Puoi assegnarle a tutto il file, solo alle righe selezionate, o modificarle riga per riga.
              </p>

              <div className="flex flex-wrap items-end gap-2 rounded bg-gray-50 p-3">
                <label className="text-sm">
                  <span className="mb-1 block text-gray-600">Categoria</span>
                  <input
                    list="known-categories"
                    value={bulkCategory}
                    onChange={(e) => setBulkCategory(e.target.value)}
                    placeholder="es. Clienti VIP"
                    className="w-56 rounded border px-2 py-1.5 text-sm"
                  />
                </label>
                <datalist id="known-categories">
                  {knownCategories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>

                <button
                  type="button"
                  onClick={() => {
                    assignCategoryTo("all", bulkCategory);
                    setBulkCategory("");
                  }}
                  disabled={!bulkCategory.trim()}
                  className="rounded bg-brand-dark px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  Assegna a tutti ({rows.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    assignCategoryTo(selected, bulkCategory);
                    setBulkCategory("");
                  }}
                  disabled={!bulkCategory.trim() || selected.size === 0}
                  className="rounded border px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Assegna ai selezionati ({selected.size})
                </button>
                <button
                  type="button"
                  onClick={clearAllCategories}
                  className="ml-auto text-xs text-gray-500 underline"
                >
                  azzera tutte le categorie
                </button>
              </div>

              {categoriesInFile.length > 0 && (
                <p className="mt-2 text-xs text-gray-600">
                  Nel file: {categoriesInFile.map((c) => (
                    <span key={c} className="mr-1 rounded-full bg-green-50 px-2 py-0.5 text-brand-dark">
                      {c}
                    </span>
                  ))}
                  {withoutCategory > 0 && (
                    <span className="ml-1 text-amber-700">· {withoutCategory} contatti senza categoria</span>
                  )}
                </p>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">
                5. Revisione — {rows.length} contatti validi
                {invalid.length > 0 && <span className="text-red-600"> · {invalid.length} scartati</span>}
              </h3>

              <div className="max-h-96 overflow-auto rounded border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-gray-500">
                    <tr>
                      <th className="w-8 px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={rows.length > 0 && selected.size === rows.length}
                          onChange={(e) =>
                            setSelected(e.target.checked ? new Set(rows.map((r) => r.rowKey)) : new Set())
                          }
                        />
                      </th>
                      <th className="px-2 py-1.5">Telefono</th>
                      <th className="px-2 py-1.5">Nome</th>
                      <th className="px-2 py-1.5 w-64">Categorie</th>
                      <th className="px-2 py-1.5">Variabili</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, MAX_REVIEW_ROWS_RENDERED).map((row) => (
                      <tr key={row.rowKey} className="border-t">
                        <td className="px-2 py-1">
                          <input
                            type="checkbox"
                            checked={selected.has(row.rowKey)}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(row.rowKey);
                                else next.delete(row.rowKey);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="px-2 py-1 font-mono">{row.phoneE164}</td>
                        <td className="px-2 py-1">{[row.firstName, row.lastName].filter(Boolean).join(" ")}</td>
                        <td className="px-2 py-1">
                          <input
                            list="known-categories"
                            value={row.categories.join(", ")}
                            onChange={(e) => setRowCategories(row.rowKey, e.target.value)}
                            placeholder="—"
                            className="w-full rounded border px-1.5 py-0.5 text-xs"
                          />
                        </td>
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

              {rows.length > MAX_REVIEW_ROWS_RENDERED && (
                <p className="mt-1 text-xs text-gray-500">
                  Mostrate le prime {MAX_REVIEW_ROWS_RENDERED} righe. "Assegna a tutti" e "Seleziona tutto"
                  agiscono comunque su tutte le {rows.length}.
                </p>
              )}

              {invalid.length > 0 && (
                <details className="mt-2 text-xs text-gray-600">
                  <summary className="cursor-pointer">Vedi righe scartate ({invalid.length})</summary>
                  <ul className="mt-1 space-y-0.5">
                    {invalid.slice(0, 20).map((r, i) => (
                      <li key={i}>
                        Riga {r.row}: {r.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            <button
              onClick={handleImport}
              disabled={busy || rows.length === 0}
              className="rounded bg-brand-dark px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy ? "Importazione..." : `Importa ${rows.length} contatti`}
            </button>
          </div>
        )}

        {result && <p className="mt-3 text-sm text-green-700">{result}</p>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ categorie */

function CategoriesOverview({
  categories,
  activeCategory,
  onFilter,
}: {
  categories: CategoryFacet[];
  activeCategory: string;
  onFilter: (category: string) => void;
}) {
  if (categories.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">Categorie</h2>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onFilter("")}
          className={`rounded-full border px-3 py-1 text-sm ${
            activeCategory === "" ? "border-brand-dark bg-green-50 text-brand-dark" : "bg-white text-gray-600"
          }`}
        >
          Tutti
        </button>
        {categories.map((c) => (
          <button
            key={c.name}
            onClick={() => onFilter(c.name)}
            className={`rounded-full border px-3 py-1 text-sm ${
              activeCategory === c.name
                ? "border-brand-dark bg-green-50 text-brand-dark"
                : "bg-white text-gray-600"
            }`}
          >
            {c.name} <span className="text-gray-400">{c.contactCount}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- contatti */

function ContactsTable({
  teamId,
  list,
  search,
  onSearchChange,
  knownCategories,
  onChanged,
}: {
  teamId: string | null;
  list: ListContactsResponse | null;
  search: string;
  onSearchChange: (v: string) => void;
  knownCategories: string[];
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contacts = list?.contacts ?? [];

  async function applyCategory(mode: "add" | "remove") {
    if (selected.size === 0 || !category.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await callTool("/contacts/categories/assign", {
        teamId,
        contactIds: Array.from(selected),
        addCategories: mode === "add" ? [category.trim()] : [],
        removeCategories: mode === "remove" ? [category.trim()] : [],
      });
      setSelected(new Set());
      setCategory("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aggiornamento categorie fallito");
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    try {
      const result = await callTool<{ csv: string; filename: string }>("/contacts/export", { teamId });
      downloadCsv(result.csv, result.filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Esportazione fallita");
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Contatti {list ? <span className="text-sm font-normal text-gray-500">({list.total})</span> : null}
        </h2>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Cerca nome, numero, email..."
            className="w-64 rounded border px-3 py-1.5 text-sm"
          />
          <button onClick={handleExport} className="rounded border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Esporta CSV
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border bg-gray-50 p-2 text-sm">
          <span className="text-gray-600">{selected.size} selezionati</span>
          <input
            list="known-categories-list"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="categoria"
            className="rounded border px-2 py-1 text-sm"
          />
          <datalist id="known-categories-list">
            {knownCategories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button
            onClick={() => applyCategory("add")}
            disabled={busy || !category.trim()}
            className="rounded bg-brand-dark px-3 py-1 text-sm font-medium text-white disabled:opacity-40"
          >
            Aggiungi categoria
          </button>
          <button
            onClick={() => applyCategory("remove")}
            disabled={busy || !category.trim()}
            className="rounded border px-3 py-1 text-sm disabled:opacity-40"
          >
            Rimuovi
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-gray-500 underline">
            deseleziona
          </button>
        </div>
      )}

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
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  checked={contacts.length > 0 && selected.size === contacts.length}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(contacts.map((c) => c.id)) : new Set())
                  }
                />
              </th>
              <th className="px-3 py-2">Telefono</th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Categorie</th>
              <th className="px-3 py-2">Tag</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        return next;
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  <Link href={`/contacts/${c.id}`} className="text-brand-dark hover:underline">
                    {c.phoneE164}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/contacts/${c.id}`} className="hover:underline">
                    {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  {c.categories.length === 0 ? (
                    <span className="text-xs text-gray-400">—</span>
                  ) : (
                    c.categories.map((cat) => (
                      <span
                        key={cat}
                        className="mr-1 rounded-full bg-green-50 px-2 py-0.5 text-xs text-brand-dark"
                      >
                        {cat}
                      </span>
                    ))
                  )}
                </td>
                <td className="px-3 py-2">
                  {c.tags.map((t) => (
                    <span key={t} className="mr-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                      {t}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">
                  Nessun contatto. Importa un file per iniziare.
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

/* -------------------------------------------------------------- segmenti */

function SegmentsSection({
  teamId,
  segments,
  availableTags,
  availableCategories,
  onCreated,
}: {
  teamId: string | null;
  segments: SegmentOutput[];
  availableTags: string[];
  availableCategories: string[];
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [matchMode, setMatchMode] = useState<"ANY" | "ALL">("ANY");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await callTool("/contacts/segments", {
        teamId,
        name,
        matchTags: selectedTags,
        matchCategories: selectedCategories,
        matchMode,
      });
      setName("");
      setSelectedTags([]);
      setSelectedCategories([]);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creazione segmento fallita");
    }
  }

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Segmenti</h2>
      <p className="mb-3 text-sm text-gray-500">
        Servono per selezioni più fini di una singola categoria (es. "categoria Clienti VIP, ma solo chi ha il
        tag milano"). Per un invio a una categoria intera non serve: la scegli direttamente nella campagna.
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

        {availableCategories.length > 0 && (
          <div>
            <span className="mb-1 block text-xs uppercase text-gray-500">Categorie</span>
            <div className="flex flex-wrap gap-2">
              {availableCategories.map((cat) => {
                const active = selectedCategories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() =>
                      setSelectedCategories((prev) =>
                        active ? prev.filter((c) => c !== cat) : [...prev, cat],
                      )
                    }
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

        <div>
          <span className="mb-1 block text-xs uppercase text-gray-500">Tag</span>
          <div className="flex flex-wrap gap-2">
            {availableTags.length === 0 && <span className="text-sm text-gray-400">Nessun tag disponibile.</span>}
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
        </div>

        <button
          type="submit"
          disabled={selectedTags.length === 0 && selectedCategories.length === 0}
          className="rounded bg-brand-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Crea segmento
        </button>
      </form>

      {segments.length > 0 && (
        <ul className="mt-3 space-y-2">
          {segments.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded border bg-white p-3 text-sm">
              <span>
                <span className="font-medium">{s.name}</span> — {s.contactCount} contatti
                <span className="text-gray-500">
                  {" "}
                  (
                  {[
                    s.matchCategories.length > 0 ? `categorie: ${s.matchCategories.join(", ")}` : null,
                    s.matchTags.length > 0
                      ? `${s.matchMode === "ANY" ? "almeno uno di" : "tutti"}: ${s.matchTags.join(", ")}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  )
                </span>
              </span>
              <button
                onClick={async () => {
                  const result = await callTool<{ csv: string; filename: string }>("/contacts/export", {
                    teamId,
                    segmentId: s.id,
                  });
                  downloadCsv(result.csv, result.filename);
                }}
                className="text-xs text-gray-500 underline"
              >
                esporta
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

/* ------------------------------------------------------------ duplicati */

interface DuplicateGroup {
  reason: "SAME_NORMALIZED_PHONE" | "SAME_NAME";
  contacts: ContactRow[];
}

function DuplicatesSection({ teamId, onChanged }: { teamId: string | null; onChanged: () => void }) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    setBusy(true);
    setError(null);
    try {
      setGroups((await callTool<DuplicateGroup[]>("/contacts/duplicates", { teamId })) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scansione fallita");
    } finally {
      setBusy(false);
    }
  }

  async function merge(keepId: string, mergeIds: string[]) {
    if (!confirm("Fondere i contatti selezionati? L'operazione non si può annullare.")) return;
    setBusy(true);
    setError(null);
    try {
      await callTool("/contacts/merge", { teamId, keepContactId: keepId, mergeContactIds: mergeIds });
      await scan();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fusione fallita");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Duplicati</h2>
        <button onClick={scan} disabled={busy} className="text-sm text-brand-dark underline disabled:opacity-40">
          {busy ? "Scansione…" : groups === null ? "Cerca duplicati" : "Ricerca di nuovo"}
        </button>
      </div>

      {groups !== null && groups.length === 0 && (
        <p className="text-sm text-gray-400">Nessun duplicato trovato: stesso numero o stesso nome+cognome.</p>
      )}

      {groups && groups.length > 0 && (
        <ul className="space-y-3">
          {groups.map((group, i) => (
            <li key={i} className="rounded border bg-white p-3">
              <p className="mb-2 text-xs uppercase text-gray-500">
                {group.reason === "SAME_NORMALIZED_PHONE" ? "Stesso numero scritto in modo diverso" : "Stesso nome e cognome"}
              </p>
              <ul className="space-y-1 text-sm">
                {group.contacts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between">
                    <Link href={`/contacts/${c.id}`} className="hover:underline">
                      {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}{" "}
                      <span className="font-mono text-xs text-gray-500">{c.phoneE164}</span>
                    </Link>
                    <button
                      onClick={() =>
                        merge(
                          c.id,
                          group.contacts.filter((other) => other.id !== c.id).map((other) => other.id),
                        )
                      }
                      className="text-xs text-gray-500 underline"
                    >
                      tieni questo, fondi gli altri
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
    categories: find(["categoria", "categorie", "category", "gruppo", "segmento"]),
    tags: find(["tag", "etichett"]),
  };
}
