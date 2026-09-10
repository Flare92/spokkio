import { Controller, Get, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { TrackingService } from "./tracking.service";

// Endpoint pubblico (nessun JwtAuthGuard): è il link che il cliente clicca
// dal messaggio WhatsApp, non può portare un token di sessione dell'operatore.
@Controller("t")
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get(":token")
  async redirect(@Param("token") token: string, @Res() res: Response) {
    const targetUrl = await this.tracking.resolveAndRegisterClick(token);
    if (!targetUrl) {
      res.status(404).send("Link non valido o scaduto");
      return;
    }
    res.redirect(302, targetUrl);
  }
}
