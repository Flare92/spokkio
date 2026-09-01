import { BadRequestException, Body, Controller, Get, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { WhatsAppService } from "./whatsapp.service";
import { WebhookIngestService } from "./webhook-ingest.service";

@Controller("webhooks/whatsapp")
export class WebhookController {
  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly ingest: WebhookIngestService,
  ) {}

  // Meta's one-time webhook verification handshake.
  @Get()
  verify(
    @Query("hub.mode") mode: string,
    @Query("hub.verify_token") token: string,
    @Query("hub.challenge") challenge: string,
    @Res() res: Response,
  ) {
    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "dev-verify-token";
    if (mode === "subscribe" && token === expected) {
      res.status(200).send(challenge);
      return;
    }
    throw new BadRequestException("Webhook verification failed");
  }

  @Post()
  async receive(@Body() payload: unknown, @Res() res: Response) {
    const events = this.whatsapp.parseStatusWebhook(payload);
    await this.ingest.handleEvents(events);
    // Meta requires a fast 200 ack regardless of downstream processing outcome.
    res.status(200).send("EVENT_RECEIVED");
  }
}
