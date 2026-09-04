"use client";

import { useCallback, useEffect, useState } from "react";
import { Nav } from "@/components/nav";
import { callTool, decodeTeamId } from "@/lib/api";
import { FunnelChart, SERIES_COLORS, STATUS_CRITICAL, TimeSeriesChart, type TimePoint } from "@/components/charts";

interface Overview {
  periodDays: number;
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  failed: number;
  inboundMessages: number;
  activeConversations: number;
  deliveryRate: number;
  readRate: number;
  clickRate: number;
  failureRate: number;
  cost: {
    metaTotal: number;
    markupTotal: number;
    total: number;
    currency: string;
    byCategory: {
      category: string;
      conversations: number;
      ratePerConversation: number;
      metaTotal: number;
    }[];
  };
}

interface CampaignPerformanceRow {
  campaignId: string;
  name: string;
  sentAt: string | null;
  status: string;
  recipients: number;
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  failed: number;
  deliveryRate: number;
  readRate: number;
  costTotal: number;
}

interface DrilldownEvent {
  contactId: string;
  messageId: string;
  occurredAt: string;
  detail: string | null;
}

const RANGES = [
  { days: 7, label: "7 giorni" },
  { days: 30, label: "30 giorni" },
  { days: 90, label: "90 giorni" },
];

export default function AnalyticsPage() {
  const teamId = decodeTeamId();
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [series, setSeries] = useState<TimePoint[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignPerformanceRow[]>([]);
  const [drilldown, setDrilldown] = useState<{
    campaign: string;
    metric: string;
    events: DrilldownEvent[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!teamId) return;
    setError(null);
    try {
      const [o, s, c] = await Promise.all([
        callTool<Overview>("/analytics/overview", { teamId, days }),
        callTool<TimePoint[]>("/analytics/time-series", { teamId, days }),
        callTool<CampaignPerformanceRow[]>("/analytics/campaign-performance", { teamId, days }),
      ]);
      setOverview(o);
      setSeries(s);
      setCampaigns(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Caricamento analytics fallito");
    }
  }, [teamId, days]);

  useEffect(() => {
    load();
  }, [load]);

  async function openDrilldown(row: CampaignPerformanceRow, metric: "delivered" | "read" | "clicked" | "failed") {
    try {
      const events = await callTool<DrilldownEvent[]>("/analytics/campaign-event-drilldown", {
        teamId,
        campaignId: row.campaignId,
        metric,
      });
      setDrilldown({ campaign: row.name, metric, events });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Drill-down non disponibile");
    }
  }

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-5xl space-y-8 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Analytics</h1>
          <div className="flex gap-1 rounded border bg-white p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={`rounded px-3 py-1 text-sm ${
                  days === r.days ? "bg-brand-dark text-white" : "text-gray-600"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {overview && (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Messaggi inviati" value={overview.sent.toLocaleString("it-IT")} />
              <StatTile
                label="Tasso di consegna"
                value={`${overview.deliveryRate}%`}
                hint={`${overview.delivered} consegnati`}
              />
              <StatTile label="Tasso di lettura" value={`${overview.readRate}%`} hint={`${overview.read} letti`} />
              <StatTile
                label="Costo periodo"
                value={`€${overview.cost.total.toFixed(2)}`}
                hint={`Meta €${overview.cost.metaTotal.toFixed(2)} + markup €${overview.cost.markupTotal.toFixed(2)}`}
              />
            </section>

            <section className="rounded border bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold">Andamento giornaliero</h2>
              <TimeSeriesChart
                data={series}
                series={[
                  { key: "sent", label: "Inviati", color: SERIES_COLORS.delivered },
                  { key: "delivered", label: "Consegnati", color: SERIES_COLORS.read },
                  { key: "read", label: "Letti", color: SERIES_COLORS.clicked },
                ]}
              />
            </section>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <section className="rounded border bg-white p-4">
                <h2 className="mb-3 text-sm font-semibold">Imbuto di consegna</h2>
                <FunnelChart
                  stages={[
                    { label: "Inviati", value: overview.sent, color: SERIES_COLORS.delivered },
                    { label: "Consegnati", value: overview.delivered, color: SERIES_COLORS.read },
                    { label: "Letti", value: overview.read, color: SERIES_COLORS.clicked },
                    { label: "Click", value: overview.clicked, color: SERIES_COLORS.clicked },
                  ]}
                />
                {overview.failed > 0 && (
                  <p className="mt-3 flex items-center gap-2 text-sm" style={{ color: STATUS_CRITICAL }}>
                    <span aria-hidden>⚠</span>
                    {overview.failed} messaggi non consegnati ({overview.failureRate}%)
                  </p>
                )}
              </section>

              <section className="rounded border bg-white p-4">
                <h2 className="mb-1 text-sm font-semibold">Come è calcolato il costo</h2>
                <p className="mb-3 text-xs text-gray-500">
                  Ogni euro qui sotto viene dalle conversazioni effettivamente partite, per categoria e con la
                  tariffa applicata in chiaro. Nessun totale aggregato senza spiegazione.
                </p>
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-gray-500">
                    <tr>
                      <th className="py-1">Categoria</th>
                      <th className="py-1 text-right">Conv.</th>
                      <th className="py-1 text-right">Tariffa</th>
                      <th className="py-1 text-right">Meta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.cost.byCategory.map((row) => (
                      <tr key={row.category} className="border-t">
                        <td className="py-1">{row.category}</td>
                        <td className="py-1 text-right">{row.conversations}</td>
                        <td className="py-1 text-right text-gray-500">
                          €{row.ratePerConversation.toFixed(4)}
                        </td>
                        <td className="py-1 text-right">€{row.metaTotal.toFixed(2)}</td>
                      </tr>
                    ))}
                    {overview.cost.byCategory.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-3 text-center text-gray-400">
                          Nessuna conversazione a pagamento nel periodo
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t font-medium">
                      <td className="py-1">Markup Spokkio</td>
                      <td />
                      <td />
                      <td className="py-1 text-right">€{overview.cost.markupTotal.toFixed(2)}</td>
                    </tr>
                    <tr className="border-t font-semibold">
                      <td className="py-1">Totale</td>
                      <td />
                      <td />
                      <td className="py-1 text-right">€{overview.cost.total.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </section>
            </div>

            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Click" value={overview.clicked.toLocaleString("it-IT")} hint={`${overview.clickRate}% sui consegnati`} />
              <StatTile label="Risposte ricevute" value={overview.inboundMessages.toLocaleString("it-IT")} />
              <StatTile label="Conversazioni aperte" value={overview.activeConversations.toLocaleString("it-IT")} />
              <StatTile label="Non consegnati" value={overview.failed.toLocaleString("it-IT")} hint={`${overview.failureRate}%`} />
            </section>
          </>
        )}

        <section>
          <h2 className="mb-1 text-sm font-semibold">Performance per campagna</h2>
          <p className="mb-3 text-xs text-gray-500">
            I numeri di consegna, lettura, click e fallimenti sono cliccabili: aprono l'elenco degli eventi
            singoli che li compongono.
          </p>
          <div className="overflow-x-auto rounded border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Campagna</th>
                  <th className="px-3 py-2 text-right">Dest.</th>
                  <th className="px-3 py-2 text-right">Inviati</th>
                  <th className="px-3 py-2 text-right">Consegnati</th>
                  <th className="px-3 py-2 text-right">Letti</th>
                  <th className="px-3 py-2 text-right">Click</th>
                  <th className="px-3 py-2 text-right">Falliti</th>
                  <th className="px-3 py-2 text-right">Costo</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((row) => (
                  <tr key={row.campaignId} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs text-gray-500">
                        {row.sentAt ? new Date(row.sentAt).toLocaleDateString("it-IT") : row.status}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">{row.recipients}</td>
                    <td className="px-3 py-2 text-right">{row.sent}</td>
                    <td className="px-3 py-2 text-right">
                      <DrilldownCell
                        value={`${row.delivered} (${row.deliveryRate}%)`}
                        onClick={() => openDrilldown(row, "delivered")}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DrilldownCell
                        value={`${row.read} (${row.readRate}%)`}
                        onClick={() => openDrilldown(row, "read")}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DrilldownCell value={String(row.clicked)} onClick={() => openDrilldown(row, "clicked")} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DrilldownCell value={String(row.failed)} onClick={() => openDrilldown(row, "failed")} />
                    </td>
                    <td className="px-3 py-2 text-right">€{row.costTotal.toFixed(2)}</td>
                  </tr>
                ))}
                {campaigns.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-400">
                      Nessuna campagna nel periodo selezionato.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {drilldown && (
          <section className="rounded border bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                Eventi "{drilldown.metric}" — {drilldown.campaign}
              </h2>
              <button onClick={() => setDrilldown(null)} className="text-xs text-gray-500 underline">
                chiudi
              </button>
            </div>
            <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
              {drilldown.events.map((e) => (
                <li key={`${e.messageId}-${e.occurredAt}`} className="rounded border px-2 py-1">
                  <span className="font-mono">{e.contactId.slice(0, 8)}</span> ·{" "}
                  {new Date(e.occurredAt).toLocaleString("it-IT")}
                  {e.detail && <span className="text-gray-500"> · {e.detail}</span>}
                </li>
              ))}
              {drilldown.events.length === 0 && (
                <li className="py-3 text-center text-gray-400">Nessun evento registrato per questa metrica.</li>
              )}
            </ul>
          </section>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </main>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

function DrilldownCell({ value, onClick }: { value: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="underline decoration-dotted underline-offset-2 hover:text-brand-dark">
      {value}
    </button>
  );
}
