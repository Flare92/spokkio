import { Injectable } from "@nestjs/common";
import type {
  ConnectWhatsAppInput,
  WhatsAppConnectionStatusInput,
  WhatsAppConnectionStatusOutput,
} from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppService } from "./whatsapp.service";

@Injectable()
export class WhatsAppConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  // Tool: whatsapp.connect
  async connect(input: ConnectWhatsAppInput): Promise<WhatsAppConnectionStatusOutput> {
    await this.prisma.whatsAppConnection.upsert({
      where: { teamId: input.teamId },
      update: {
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: input.displayPhoneNumber,
        accessTokenEncrypted: input.accessToken,
      },
      create: {
        teamId: input.teamId,
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: input.displayPhoneNumber,
        accessTokenEncrypted: input.accessToken,
      },
    });

    return this.status({ teamId: input.teamId });
  }

  // Tool: whatsapp.connectionStatus
  async status(input: WhatsAppConnectionStatusInput): Promise<WhatsAppConnectionStatusOutput> {
    const connection = await this.prisma.whatsAppConnection.findUnique({
      where: { teamId: input.teamId },
    });

    if (!connection) {
      return {
        connected: false,
        wabaId: null,
        phoneNumberId: null,
        displayPhoneNumber: null,
        connectedAt: null,
        tokenValid: null,
        tokenError: null,
      };
    }

    const check = await this.whatsapp.verifyCredentials({
      phoneNumberId: connection.phoneNumberId,
      accessToken: connection.accessTokenEncrypted,
    });

    return {
      connected: true,
      wabaId: connection.wabaId,
      phoneNumberId: connection.phoneNumberId,
      displayPhoneNumber: connection.displayPhoneNumber,
      connectedAt: connection.connectedAt.toISOString(),
      tokenValid: check.valid,
      tokenError: check.error ?? null,
    };
  }
}
