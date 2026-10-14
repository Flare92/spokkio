import { TemplatesService } from "./templates.service";

describe("TemplatesService.syncStatus", () => {
  function setup(metaResult: unknown) {
    const prisma = {
      template: {
        findFirst: jest.fn().mockResolvedValue({ id: "tpl-1", teamId: "team-1", metaTemplateId: "meta-1" }),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({
            id: "tpl-1",
            name: "promo",
            category: "MARKETING",
            language: "it",
            bodyText: "Ciao",
            metaTemplateId: "meta-1",
            submissionError: null,
            headerImageId: null,
            ...data,
          }),
        ),
      },
      whatsAppConnection: { findUnique: jest.fn().mockResolvedValue({ accessTokenEncrypted: "token" }) },
    };
    const whatsapp = { getTemplateStatus: jest.fn().mockResolvedValue(metaResult) };
    return { service: new TemplatesService(prisma as any, whatsapp as any, {} as any), prisma };
  }

  it("marks the template APPROVED when Meta approved it while the webhook was off", async () => {
    const { service } = setup({ status: "APPROVED", rejectedReason: null });
    const out = await service.syncStatus({ teamId: "team-1", templateId: "tpl-1" });
    expect(out.status).toBe("APPROVED");
  });

  it("keeps the rejection reason from Meta", async () => {
    const { service } = setup({ status: "REJECTED", rejectedReason: "INVALID_FORMAT" });
    const out = await service.syncStatus({ teamId: "team-1", templateId: "tpl-1" });
    expect(out.status).toBe("REJECTED");
    expect(out.rejectionReason).toBe("INVALID_FORMAT");
  });

  it("treats a template paused by Meta as not usable", async () => {
    const { service } = setup({ status: "PAUSED", rejectedReason: null });
    const out = await service.syncStatus({ teamId: "team-1", templateId: "tpl-1" });
    expect(out.status).toBe("REJECTED");
    expect(out.rejectionReason).toContain("pausa");
  });

  it("stays in review while Meta is still reviewing", async () => {
    const { service } = setup({ status: "PENDING", rejectedReason: null });
    const out = await service.syncStatus({ teamId: "team-1", templateId: "tpl-1" });
    expect(out.status).toBe("PENDING_REVIEW");
  });

  it("reports Meta errors instead of changing the status", async () => {
    const { service, prisma } = setup({ error: "token scaduto" });
    await expect(service.syncStatus({ teamId: "team-1", templateId: "tpl-1" })).rejects.toThrow("token scaduto");
    expect(prisma.template.update).not.toHaveBeenCalled();
  });
});
