"use client";

import { useState } from "react";
import { Nav } from "@/components/nav";
import { callTool, decodeTeamId } from "@/lib/api";

interface SegmentOutput {
  id: string;
  name: string;
  matchTags: string[];
  matchMode: "ANY" | "ALL";
  contactCount: number;
}

export default function ContactsPage() {
  const teamId = decodeTeamId();
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [tags, setTags] = useState("");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [segmentName, setSegmentName] = useState("");
  const [segmentTags, setSegmentTags] = useState("");
  const [segments, setSegments] = useState<SegmentOutput[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setImportMessage(null);
    try {
      const result = await callTool<{ imported: number; skippedDuplicates: number }>("/contacts/import", {
        teamId,
        source: "CSV",
        rows: [{ phoneE164: phone, firstName, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) }],
      });
      setImportMessage(`Importato: ${result.imported}, duplicati saltati: ${result.skippedDuplicates}`);
      setPhone("");
      setFirstName("");
      setTags("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import fallito");
    }
  }

  async function handleCreateSegment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const segment = await callTool<SegmentOutput>("/contacts/segments", {
        teamId,
        name: segmentName,
        matchTags: segmentTags.split(",").map((t) => t.trim()).filter(Boolean),
        matchMode: "ANY",
      });
      setSegments((prev) => [...prev, segment]);
      setSegmentName("");
      setSegmentTags("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creazione segmento fallita");
    }
  }

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-3xl space-y-8 p-6">
        <section>
          <h1 className="mb-1 text-lg font-semibold">Contatti</h1>
          <p className="mb-4 text-sm text-gray-500">
            Aggiungi un contatto (per l&apos;import CSV completo, carica un file da questa stessa form in una
            versione futura — qui puoi aggiungerne uno alla volta per il test end-to-end).
          </p>
          <form onSubmit={handleImport} className="grid grid-cols-1 gap-3 rounded border bg-white p-4 sm:grid-cols-3">
            <input
              required
              placeholder="+393331234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded border px-3 py-2 text-sm"
            />
            <input
              placeholder="Nome"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="rounded border px-3 py-2 text-sm"
            />
            <input
              placeholder="tag1, tag2"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="rounded border px-3 py-2 text-sm"
            />
            <button type="submit" className="col-span-full rounded bg-brand-dark py-2 text-sm font-medium text-white">
              Aggiungi contatto
            </button>
          </form>
          {importMessage && <p className="mt-2 text-sm text-green-700">{importMessage}</p>}
        </section>

        <section>
          <h2 className="mb-1 text-lg font-semibold">Segmenti</h2>
          <p className="mb-4 text-sm text-gray-500">
            Un segmento è una regola sui tag, sempre ispezionabile: nessuna segmentazione a scatola nera.
          </p>
          <form onSubmit={handleCreateSegment} className="grid grid-cols-1 gap-3 rounded border bg-white p-4 sm:grid-cols-3">
            <input
              required
              placeholder="Nome segmento"
              value={segmentName}
              onChange={(e) => setSegmentName(e.target.value)}
              className="rounded border px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="tag1, tag2"
              value={segmentTags}
              onChange={(e) => setSegmentTags(e.target.value)}
              className="rounded border px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded bg-brand-dark py-2 text-sm font-medium text-white">
              Crea segmento
            </button>
          </form>

          {segments.length > 0 && (
            <ul className="mt-4 space-y-2">
              {segments.map((s) => (
                <li key={s.id} className="rounded border bg-white p-3 text-sm">
                  <span className="font-medium">{s.name}</span> — {s.contactCount} contatti (match: {s.matchTags.join(", ")})
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </main>
    </div>
  );
}
