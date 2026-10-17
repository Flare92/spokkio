import { AnalyticsService } from "./analytics.service";

const TEAM = "00000000-0000-4000-8000-000000000001";
const CAMPAIGN = "00000000-0000-4000-8000-000000000002";

function outbound(id: string, contactId: string, status: string, createdAt: string) {
  return {
    id,
    status,
    createdAt: new Date(createdAt),
    deliveredAt: status === "DELIVERED" || status === "READ" ? new Date(createdAt) : null,
    readAt: status === "READ" ? new Date(createdAt) : null,
    failedReason: null,
    conversation: {
      contactId,
      contact: { id: contactId, firstName: "Giada", lastName: null, phoneE164: `+39${contactId}` },
    },
  };
}

describe("AnalyticsService.campaignRecipients", () => {
  it("reports per-recipient status and only counts replies within 7 days after the send", async () => {
    const prisma = {
      campaign: { findFirst: jest.fn().mockResolvedValue({ id: CAMPAIGN, teamId: TEAM }) },
      message: { findMany: jest.fn() },
    };
    prisma.message.findMany
      .mockResolvedValueOnce([
        outbound("m1", "c1", "READ", "2026-10-10T10:00:00Z"),
        outbound("m2", "c2", "DELIVERED", "2026-10-10T10:00:00Z"),
        outbound("m3", "c3", "SENT", "2026-10-10T10:00:00Z"),
      ])
      .mockResolvedValueOnce([
        // c1 risponde dopo un'ora: conta.
        { createdAt: new Date("2026-10-10T11:00:00Z"), text: "Grazie!", conversation: { contactId: "c1" } },
        // c2 risponde dopo 10 giorni: fuori finestra.
        { createdAt: new Date("2026-10-20T10:00:00Z"), text: "Info?", conversation: { contactId: "c2" } },
      ]);

    const service = new AnalyticsService(prisma as any);
    const rows = await service.campaignRecipients({ teamId: TEAM, campaignId: CAMPAIGN });

    expect(rows.map((r) => [r.contactId, r.status, r.replyText])).toEqual([
      ["c1", "READ", "Grazie!"],
      ["c2", "DELIVERED", null],
      ["c3", "SENT", null],
    ]);
    expect(rows[0].name).toBe("Giada");
  });
});

describe("AnalyticsService.campaignReport", () => {
  it("computes rates, timeline, medians and failure reasons from stored messages", async () => {
    const sentAt = new Date(Date.now() - 5 * 3600_000); // 5 ore fa
    const at = (minutes: number) => new Date(sentAt.getTime() + minutes * 60_000);
    const msg = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
      id,
      status,
      createdAt: sentAt,
      deliveredAt: null,
      readAt: null,
      failedReason: null,
      conversation: { contactId: `c-${id}` },
      ...extra,
    });
    const prisma = {
      campaign: {
        findFirst: jest.fn().mockResolvedValue({
          id: CAMPAIGN,
          name: "Promo",
          status: "SENT",
          sentAt,
          template: { name: "promo", category: "MARKETING" },
          segment: { name: "Clienti", _count: { contacts: 4 } },
        }),
      },
      message: { findMany: jest.fn() },
      attributionEvent: { count: jest.fn().mockResolvedValue(1) },
    };
    prisma.message.findMany
      .mockResolvedValueOnce([
        msg("m1", "READ", { deliveredAt: at(1), readAt: at(30) }),
        msg("m2", "READ", { readAt: at(150) }), // letto senza "consegnato" registrato
        msg("m3", "DELIVERED", { deliveredAt: at(2) }),
        msg("m4", "FAILED", { failedReason: "Numero non su WhatsApp" }),
      ])
      .mockResolvedValueOnce([{ createdAt: at(90), text: "Info?", conversation: { contactId: "c-m1" } }]);

    const service = new AnalyticsService(prisma as any);
    const r = await service.campaignReport({ teamId: TEAM, campaignId: CAMPAIGN });

    expect([r.sent, r.delivered, r.read, r.replied, r.failed, r.clicked]).toEqual([4, 3, 2, 1, 1, 1]);
    expect(r.readRate).toBe(66.7);
    expect(r.replyRate).toBe(33.3);
    expect(r.medianMinutesToRead).toBe(90); // mediana di 30 e 150
    expect(r.medianMinutesToReply).toBe(90);
    expect(r.failureReasons).toEqual([{ reason: "Numero non su WhatsApp", count: 1 }]);
    // Dopo 1 ora: m1 e m3 consegnati, m1 letto; dopo 3 ore anche m2 (letto => consegnato) e la risposta.
    expect(r.timeline[1]).toEqual({ hour: 1, delivered: 2, read: 1, replied: 0 });
    expect(r.timeline[3]).toEqual({ hour: 3, delivered: 3, read: 2, replied: 1 });
  });
});
