import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  // Registra il click e restituisce l'URL reale a cui reindirizzare, o null
  // se il token non corrisponde a nessun link tracciato.
  async resolveAndRegisterClick(token: string): Promise<string | null> {
    const link = await this.prisma.trackedLink.findUnique({ where: { token } });
    if (!link) return null;

    await this.prisma.trackedLink.update({
      where: { id: link.id },
      data: {
        clickCount: { increment: 1 },
        firstClickedAt: link.firstClickedAt ?? new Date(),
      },
    });

    // Un solo evento "clicked" per messaggio: click ripetuti sullo stesso
    // link non gonfiano il tasso di click mostrato in analytics.
    if (!link.firstClickedAt) {
      await this.prisma.attributionEvent.create({
        data: { contactId: link.contactId, messageId: link.messageId, kind: "clicked" },
      });
    }

    return link.targetUrl;
  }
}
