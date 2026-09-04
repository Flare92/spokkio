"use client";

import { useCallback, useEffect, useState } from "react";
import { Nav } from "@/components/nav";
import { callTool, decodeTeamId } from "@/lib/api";

interface ConnectionStatus {
  connected: boolean;
  wabaId: string | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  connectedAt: string | null;
  tokenValid: boolean | null;
  tokenError: string | null;
}

export default function SettingsPage() {
  const teamId = decodeTeamId();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [wabaId, setWabaId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!teamId) return;
    try {
      setStatus(await callTool<ConnectionStatus>("/whatsapp/status", { teamId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile leggere lo stato della connessione");
    }
  }, [teamId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await callTool<ConnectionStatus>("/whatsapp/connect", {
        teamId,
        wabaId,
        phoneNumberId,
        displayPhoneNumber,
        accessToken,
      });
      setStatus(result);
      setAccessToken("");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Collegamento fallito");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="text-lg font-semibold">Impostazioni</h1>

        <section className="rounded border bg-white p-5">
          <h2 className="mb-1 text-sm font-semibold">Numero WhatsApp collegato</h2>
          <p className="mb-4 text-sm text-gray-500">
            I valori si trovano su developers.facebook.com nella tua app, sezione WhatsApp → API Setup. Puoi usare
            sia il numero di test gratuito di Meta sia il tuo numero aziendale, una volta collegato lì.
          </p>

          {status?.connected ? (
            <div className="space-y-3">
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <Row label="Numero" value={status.displayPhoneNumber ?? "—"} />
                <Row label="Phone number ID" value={status.phoneNumberId ?? "—"} mono />
                <Row label="WABA ID" value={status.wabaId ?? "—"} mono />
                <Row
                  label="Collegato il"
                  value={status.connectedAt ? new Date(status.connectedAt).toLocaleString("it-IT") : "—"}
                />
              </dl>

              {status.tokenValid === true && (
                <p className="flex items-center gap-2 rounded bg-green-50 px-3 py-2 text-sm text-green-800">
                  <span aria-hidden>✓</span> Token valido: Spokkio riesce a parlare con Meta.
                </p>
              )}
              {status.tokenValid === false && (
                <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
                  <p className="flex items-center gap-2 font-medium">
                    <span aria-hidden>⚠</span> Token non valido o scaduto
                  </p>
                  {status.tokenError && <p className="mt-1 text-xs">{status.tokenError}</p>}
                  <p className="mt-1 text-xs">
                    I token temporanei di Meta scadono dopo 24 ore: rigenerane uno dalla pagina API Setup e
                    reinseriscilo qui sotto.
                  </p>
                </div>
              )}

              <button onClick={() => setShowForm((v) => !v)} className="text-sm text-brand-dark underline">
                {showForm ? "annulla" : "aggiorna credenziali"}
              </button>
            </div>
          ) : (
            <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Nessun numero collegato: senza questo, le campagne non possono partire.
            </p>
          )}

          {(showForm || !status?.connected) && (
            <form onSubmit={handleConnect} className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-gray-600">WhatsApp Business Account ID (WABA ID)</span>
                <input
                  required
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  className="w-full rounded border px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-gray-600">Phone number ID</span>
                <input
                  required
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  className="w-full rounded border px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-gray-600">Numero mostrato (es. +393331234567)</span>
                <input
                  required
                  value={displayPhoneNumber}
                  onChange={(e) => setDisplayPhoneNumber(e.target.value)}
                  className="w-full rounded border px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-gray-600">Access token</span>
                <input
                  required
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  className="w-full rounded border px-3 py-2 text-sm"
                />
              </label>

              <button
                type="submit"
                disabled={busy}
                className="rounded bg-brand-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy ? "Verifica in corso…" : "Collega e verifica"}
              </button>
            </form>
          )}

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </section>

        <section className="rounded border bg-white p-5 text-sm text-gray-600">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Collegare il numero aziendale</h2>
          <p>
            Per usare il numero che i tuoi clienti già conoscono, va spostato dall'app WhatsApp Business alla
            Cloud API dalla stessa pagina di Meta. Attenzione: dopo la migrazione l'app sul telefono si
            disconnette da quel numero e la messaggistica passa da qui. Il percorso completo, con i link, è nel
            file <code className="rounded bg-gray-100 px-1">docs/META_SETUP.md</code> del progetto.
          </p>
        </section>
      </main>
    </div>
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
