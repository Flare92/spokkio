import { Module } from "@nestjs/common";
import { WhatsAppService } from "./whatsapp.service";
import { WebhookController } from "./webhook.controller";
import { WebhookIngestService } from "./webhook-ingest.service";
import { WhatsAppConnectionService } from "./connection.service";
import { WhatsAppConnectionController } from "./connection.controller";

@Module({
  providers: [WhatsAppService, WebhookIngestService, WhatsAppConnectionService],
  controllers: [WebhookController, WhatsAppConnectionController],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
