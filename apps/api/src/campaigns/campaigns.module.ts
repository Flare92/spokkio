import { Module } from "@nestjs/common";
import { CampaignsService } from "./campaigns.service";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsSchedulerService } from "./campaigns-scheduler.service";
import { WhatsAppModule } from "../whatsapp/whatsapp.module";

@Module({
  imports: [WhatsAppModule],
  providers: [CampaignsService, CampaignsSchedulerService],
  controllers: [CampaignsController],
  exports: [CampaignsService],
})
export class CampaignsModule {}
