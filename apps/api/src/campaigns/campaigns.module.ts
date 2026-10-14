import { Module } from "@nestjs/common";
import { CampaignsService } from "./campaigns.service";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsSchedulerService } from "./campaigns-scheduler.service";
import { WhatsAppModule } from "../whatsapp/whatsapp.module";
import { MediaModule } from "../media/media.module";

@Module({
  imports: [WhatsAppModule, MediaModule],
  providers: [CampaignsService, CampaignsSchedulerService],
  controllers: [CampaignsController],
  exports: [CampaignsService],
})
export class CampaignsModule {}
