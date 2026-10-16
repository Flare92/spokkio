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
