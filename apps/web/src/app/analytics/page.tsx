"use client";

import { useState } from "react";
import { Nav } from "@/components/nav";
import { callTool, decodeTeamId } from "@/lib/api";

interface CampaignStatsOutput {
  campaignId: string;
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  failed: number;
}
interface DrilldownEvent {
  contactId: string;
  messageId: string;
  occurredAt: string;
  detail: string | null;
}

export default function AnalyticsPage() {
  const teamId = decodeTeamId();
  const [campaignId, setCampaignId] = useState("");
  const [stats, setStats] = useState<CampaignStatsOutput | null>(null);
  const [drilldown, setDrilldown] = useState<DrilldownEvent[] | null>(null);
  const [drilldownMetric, setDrilldownMetric] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadStats(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDrilldown(null);
    try {
      const result = await callTool<CampaignStatsOutput>("/analytics/campaign-stats", { teamId, campaignId });
      setStats(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile caricare le statistiche");
    }
  }

  async function loadDrilldown(metric: "delivered" | "read" | "clicked" | "failed") {
    if (!stats) return;
    setError(null);
    try {
      const events = await callTool<DrilldownEvent[]>("/analytics/campaign-event-drilldown", {
        teamId,
        campaignId: stats.campaignId,
        metric,
      });
      setDrilldown(events);
      setDrilldownMetric(metric);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Drill-down non disponibile");
    }
  }

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="text-lg font-semibold">Analytics campagna</h1>
        <p className="text-sm text-gray-500">
          Ogni numero qui sotto è cliccabile: puoi sempre scendere fino al singolo evento/contatto (nessun numero
          aggregato opaco).
        </p>
        <form onSubmit={loadStats} className="flex gap-2">
          <input
            required
            placeholder="ID campagna"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="flex-1 rounded border px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded bg-brand-dark px-4 py-2 text-sm font-medium text-white">
            Carica
          </button>
        </form>

        {stats && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(["sent", "delivered", "read", "clicked", "failed"] as const).map((metric) => (
              <button
                key={metric}
                onClick={() => metric !== "sent" && loadDrilldown(metric)}
                className="rounded border bg-white p-3 text-left hover:bg-gray-50"
              >
                <div className="text-xs uppercase text-gray-400">{metric}</div>
                <div className="text-xl font-semibold">{stats[metric]}</div>
              </button>
            ))}
          </div>
        )}

        {drilldown && (
          <div>
            <h2 className="mb-2 text-sm font-semibold">Eventi: {drilldownMetric}</h2>
            <ul className="space-y-1 text-sm">
              {drilldown.map((ev) => (
                <li key={ev.messageId} className="rounded border bg-white p-2">
                  Contatto {ev.contactId} — {new Date(ev.occurredAt).toLocaleString("it-IT")}
                  {ev.detail && <span className="text-gray-500"> ({ev.detail})</span>}
                </li>
              ))}
              {drilldown.length === 0 && <p className="text-gray-400">Nessun evento.</p>}
            </ul>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </main>
    </div>
  );
}
