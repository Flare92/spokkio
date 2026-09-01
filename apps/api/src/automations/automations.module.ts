import { Module } from "@nestjs/common";
import { AutomationsService } from "./automations.service";
import { AutomationsController } from "./automations.controller";
import { AutomationsSchedulerService } from "./automations-scheduler.service";
import { WhatsAppModule } from "../whatsapp/whatsapp.module";

@Module({
  imports: [WhatsAppModule],
  providers: [AutomationsService, AutomationsSchedulerService],
  controllers: [AutomationsController],
  exports: [AutomationsService],
})
export class AutomationsModule {}
