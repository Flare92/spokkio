import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { CampaignsService } from "./campaigns.service";

// Fa partire le campagne programmate quando arriva la loro ora. Il costo
// accettato è già stato registrato al momento della programmazione, quindi
// qui non si ricontratta nulla: si consegna e basta.
@Injectable()
export class CampaignsSchedulerService {
  private readonly logger = new Logger(CampaignsSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sendDueCampaigns() {
    const due = await this.prisma.campaign.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    });

    for (const campaign of due) {
      try {
        this.logger.log(`Invio campagna programmata "${campaign.name}"`);
        await this.campaigns.deliverCampaign(campaign.id);
      } catch (err) {
        this.logger.error(`Campagna programmata ${campaign.id} fallita`, err as Error);
        await this.prisma.campaign.update({ where: { id: campaign.id }, data: { status: "FAILED" } });
      }
    }
  }
}
