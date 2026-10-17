import { z } from "zod";
import { MessageCategoryValues } from "../enums";

export const CampaignStatsInput = z.object({
  teamId: z.string().uuid(),
  campaignId: z.string().uuid(),
});
export type CampaignStatsInput = z.infer<typeof CampaignStatsInput>;

export const CampaignStatsOutput = z.object({
  campaignId: z.string().uuid(),
  sent: z.number().int(),
  delivered: z.number().int(),
  read: z.number().int(),
  clicked: z.number().int(),
  failed: z.number().int(),
});
export type CampaignStatsOutput = z.infer<typeof CampaignStatsOutput>;

// Every aggregate stat must support drill-down to the underlying events —
// no opaque ROI numbers (product constraint: inspectable methodology).
export const CampaignEventDrilldownInput = z.object({
  teamId: z.string().uuid(),
  campaignId: z.string().uuid(),
  metric: z.enum(["delivered", "read", "clicked", "failed"]),
});
export type CampaignEventDrilldownInput = z.infer<typeof CampaignEventDrilldownInput>;

export const CampaignEventDrilldownOutput = z.array(
  z.object({
    contactId: z.string().uuid(),
    messageId: z.string().uuid(),
    occurredAt: z.string().datetime(),
    detail: z.string().nullable(),
  }),
);
export type CampaignEventDrilldownOutput = z.infer<typeof CampaignEventDrilldownOutput>;

export const AnalyticsRangeInput = z.object({
  teamId: z.string().uuid(),
  days: z.number().int().min(1).max(365).default(30),
});
export type AnalyticsRangeInput = z.infer<typeof AnalyticsRangeInput>;

// I costi sono calcolati sommando le tariffe per categoria dei messaggi
// effettivamente inviati: nessun totale "di comodo", ogni euro qui è
// riconducibile alle conversazioni che lo hanno generato.
export const AnalyticsOverviewOutput = z.object({
  periodDays: z.number().int(),
  sent: z.number().int(),
  delivered: z.number().int(),
  read: z.number().int(),
  clicked: z.number().int(),
  failed: z.number().int(),
  inboundMessages: z.number().int(),
  activeConversations: z.number().int(),
  deliveryRate: z.number(),
  readRate: z.number(),
  clickRate: z.number(),
  failureRate: z.number(),
  cost: z.object({
    metaTotal: z.number(),
    markupTotal: z.number(),
    total: z.number(),
    currency: z.literal("EUR"),
    byCategory: z.array(
      z.object({
        category: z.enum(MessageCategoryValues),
        conversations: z.number().int(),
        ratePerConversation: z.number(),
        metaTotal: z.number(),
      }),
    ),
  }),
});
export type AnalyticsOverviewOutput = z.infer<typeof AnalyticsOverviewOutput>;

export const AnalyticsTimeSeriesOutput = z.array(
  z.object({
    date: z.string(), // YYYY-MM-DD
    sent: z.number().int(),
    delivered: z.number().int(),
    read: z.number().int(),
    failed: z.number().int(),
  }),
);
export type AnalyticsTimeSeriesOutput = z.infer<typeof AnalyticsTimeSeriesOutput>;

export const CampaignPerformanceOutput = z.array(
  z.object({
    campaignId: z.string().uuid(),
    name: z.string(),
    sentAt: z.string().datetime().nullable(),
    status: z.string(),
    recipients: z.number().int(),
    sent: z.number().int(),
    delivered: z.number().int(),
    read: z.number().int(),
    clicked: z.number().int(),
    failed: z.number().int(),
    deliveryRate: z.number(),
    readRate: z.number(),
    // Destinatari che hanno risposto entro REPLY_WINDOW_DAYS dalla campagna.
    replied: z.number().int(),
    replyRate: z.number(),
    costTotal: z.number(),
  }),
);
export type CampaignPerformanceOutput = z.infer<typeof CampaignPerformanceOutput>;

// Esito per singolo destinatario: consegna, lettura, fallimento e risposta.
export const CampaignRecipientsInput = z.object({
  teamId: z.string().uuid(),
  campaignId: z.string().uuid(),
});
export type CampaignRecipientsInput = z.infer<typeof CampaignRecipientsInput>;

export const CampaignRecipientOutput = z.object({
  contactId: z.string().uuid(),
  name: z.string().nullable(),
  phoneE164: z.string(),
  status: z.enum(["QUEUED", "SENT", "DELIVERED", "READ", "FAILED"]),
  sentAt: z.string().datetime(),
  deliveredAt: z.string().datetime().nullable(),
  readAt: z.string().datetime().nullable(),
  failedReason: z.string().nullable(),
  repliedAt: z.string().datetime().nullable(),
  replyText: z.string().nullable(),
});
export type CampaignRecipientOutput = z.infer<typeof CampaignRecipientOutput>;

// Rapporto completo di una singola campagna, calcolato dai messaggi salvati:
// vale anche per le campagne inviate prima che esistesse questa vista.
export const CampaignReportInput = z.object({
  teamId: z.string().uuid(),
  campaignId: z.string().uuid(),
});
export type CampaignReportInput = z.infer<typeof CampaignReportInput>;

export const CampaignReportOutput = z.object({
  campaignId: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  templateName: z.string(),
  segmentName: z.string(),
  sentAt: z.string().datetime().nullable(),
  recipients: z.number().int(),
  sent: z.number().int(),
  delivered: z.number().int(),
  read: z.number().int(),
  replied: z.number().int(),
  clicked: z.number().int(),
  failed: z.number().int(),
  pending: z.number().int(), // inviati ma non ancora consegnati
  deliveryRate: z.number(),
  readRate: z.number(),
  replyRate: z.number(),
  clickRate: z.number(),
  costTotal: z.number(),
  costPerReply: z.number().nullable(),
  medianMinutesToRead: z.number().nullable(),
  medianMinutesToReply: z.number().nullable(),
  // Andamento cumulativo nelle ore successive all'invio.
  timeline: z.array(
    z.object({
      hour: z.number().int(), // ore dall'invio
      delivered: z.number().int(),
      read: z.number().int(),
      replied: z.number().int(),
    }),
  ),
  failureReasons: z.array(z.object({ reason: z.string(), count: z.number().int() })),
});
export type CampaignReportOutput = z.infer<typeof CampaignReportOutput>;

// "A rischio" = un contatto che ha già avuto almeno una conversazione reale
// (non un contatto appena importato e mai contattato) ma che non dà segnali
// di attività (risposte, visite) da più del periodo scelto.
export const AtRiskCustomersInput = z.object({
  teamId: z.string().uuid(),
  inactivityDays: z.number().int().min(1).max(365).default(45),
});
export type AtRiskCustomersInput = z.infer<typeof AtRiskCustomersInput>;

export const AtRiskCustomerOutput = z.object({
  contactId: z.string().uuid(),
  name: z.string().nullable(),
  phoneE164: z.string(),
  categories: z.array(z.string()),
  lastActivityAt: z.string().datetime(),
  daysSinceActivity: z.number().int(),
});
export type AtRiskCustomerOutput = z.infer<typeof AtRiskCustomerOutput>;

export const ANALYTICS_TOOLS = {
  "analytics.campaignStats": { input: CampaignStatsInput, output: CampaignStatsOutput },
  "analytics.campaignEventDrilldown": {
    input: CampaignEventDrilldownInput,
    output: CampaignEventDrilldownOutput,
  },
  "analytics.overview": { input: AnalyticsRangeInput, output: AnalyticsOverviewOutput },
  "analytics.timeSeries": { input: AnalyticsRangeInput, output: AnalyticsTimeSeriesOutput },
  "analytics.campaignPerformance": { input: AnalyticsRangeInput, output: CampaignPerformanceOutput },
  "analytics.campaignRecipients": {
    input: CampaignRecipientsInput,
    output: z.array(CampaignRecipientOutput),
  },
  "analytics.campaignReport": { input: CampaignReportInput, output: CampaignReportOutput },
  "analytics.atRiskCustomers": { input: AtRiskCustomersInput, output: z.array(AtRiskCustomerOutput) },
} as const;
