import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ConnectWhatsAppInput, WhatsAppConnectionStatusInput } from "@spokkio/shared";
import { WhatsAppConnectionService } from "./connection.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TeamScopeGuard } from "../auth/team-scope.guard";

@UseGuards(JwtAuthGuard, TeamScopeGuard)
@Controller("whatsapp")
export class WhatsAppConnectionController {
  constructor(private readonly connection: WhatsAppConnectionService) {}

  // tool: whatsapp.connect
  @Post("connect")
  connect(@Body(new ZodValidationPipe(ConnectWhatsAppInput)) body: ConnectWhatsAppInput) {
    return this.connection.connect(body);
  }

  // tool: whatsapp.connectionStatus
  @Post("status")
  status(@Body(new ZodValidationPipe(WhatsAppConnectionStatusInput)) body: WhatsAppConnectionStatusInput) {
    return this.connection.status(body);
  }
}
