import { Module } from "@nestjs/common";
import { WhatsAppService } from "./whatsapp.service";
import { WebhookController } from "./webhook.controller";
import { WebhookIngestService } from "./webhook-ingest.service";

@Module({
  providers: [WhatsAppService, WebhookIngestService],
  controllers: [WebhookController],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
