"use client";

import { useEffect, useState } from "react";
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
}

export default function CampaignsPage() {
  const teamId = decodeTeamId();
  const [segments, setSegments] = useState<SegmentOutput[]>([]);
  const [templates, setTemplates] = useState<TemplateOutput[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [estimate, setEstimate] = useState<CostEstimateOutput | null>(null);
  const [campaign, setCampaign] = useState<CampaignOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId) return;
    callTool<SegmentOutput[]>("/contacts/segments/list", { teamId }).then(setSegments).catch(() => {});
    callTool<TemplateOutput[]>("/templates/list", { teamId }).then(setTemplates).catch(() => {});
  }, [teamId]);

  async function handleCreateTemplate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const template = await callTool<TemplateOutput>("/templates", {
        teamId,
        name: templateName,
        category: "MARKETING",
        language: "it",
        bodyText: templateBody,
        variables: [],
      });
      setTemplates((prev) => [template, ...prev]);
      setTemplateName("");
      setTemplateBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creazione template fallita");
    }
  }

  async function handleEstimate() {
    if (!segmentId) return;
    setError(null);
    try {
      const result = await callTool<CostEstimateOutput>("/campaigns/estimate-cost", {
        teamId,
        segmentId,
        templateCategory: "MARKETING",
      });
      setEstimate(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulazione costo fallita");
    }
  }

  async function handleCreateCampaign(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await callTool<CampaignOutput>("/campaigns", {
        teamId,
        name: campaignName,
        segmentId,
        templateId,
      });
      setCampaign(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creazione campagna fallita");
    }
  }

  async function handleSend() {
    if (!campaign || !estimate) return;
    setError(null);
    try {
      const sent = await callTool<CampaignOutput>("/campaigns/send", {
        teamId,
        campaignId: campaign.id,
        acceptedCostEstimateTotal: estimate.estimatedTotal,
      });
      setCampaign(sent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invio campagna fallito");
    }
  }

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-3xl space-y-8 p-6">
        <section>
          <h1 className="mb-1 text-lg font-semibold">Template</h1>
          <p className="mb-4 text-sm text-gray-500">
            Un template deve essere approvato da Meta (stato APPROVED) prima di poter essere usato in una campagna.
          </p>
          <form onSubmit={handleCreateTemplate} className="grid grid-cols-1 gap-3 rounded border bg-white p-4 sm:grid-cols-2">
            <input
              required
              placeholder="Nome template"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="rounded border px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="Testo messaggio"
              value={templateBody}
              onChange={(e) => setTemplateBody(e.target.value)}
              className="rounded border px-3 py-2 text-sm"
            />
            <button type="submit" className="col-span-full rounded bg-brand-dark py-2 text-sm font-medium text-white">
              Crea template
            </button>
          </form>
          <ul className="mt-3 space-y-1 text-sm">
            {templates.map((t) => (
              <li key={t.id}>
                {t.name} — <span className="font-medium">{t.status}</span>
                {t.rejectionReason && <span className="text-red-600"> ({t.rejectionReason})</span>}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-1 text-lg font-semibold">Nuova campagna</h2>
          <form onSubmit={handleCreateCampaign} className="space-y-3 rounded border bg-white p-4">
            <input
              required
              placeholder="Nome campagna"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm"
            />
            <select
              required
              value={segmentId}
              onChange={(e) => {
                setSegmentId(e.target.value);
                setEstimate(null);
              }}
              className="w-full rounded border px-3 py-2 text-sm"
            >
              <option value="">Seleziona segmento</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.contactCount} contatti)
                </option>
              ))}
            </select>
            <select
              required
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm"
            >
              <option value="">Seleziona template</option>
              {templates
                .filter((t) => t.status === "APPROVED")
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>

            <button type="button" onClick={handleEstimate} className="rounded border px-4 py-2 text-sm">
              Simula costo
            </button>

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

            <button type="submit" className="w-full rounded bg-brand-dark py-2 text-sm font-medium text-white">
              Crea campagna (bozza)
            </button>
          </form>

          {campaign && (
            <div className="mt-4 rounded border bg-white p-4 text-sm">
              <p>
                Campagna <span className="font-medium">{campaign.name}</span> — stato: {campaign.status} —{" "}
                {campaign.recipientCount} destinatari
              </p>
              {campaign.status === "DRAFT" && estimate && (
                <button onClick={handleSend} className="mt-2 rounded bg-brand-dark px-4 py-2 text-sm font-medium text-white">
                  Invia ora (accetto il costo stimato sopra)
                </button>
              )}
            </div>
          )}
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </main>
    </div>
  );
}
