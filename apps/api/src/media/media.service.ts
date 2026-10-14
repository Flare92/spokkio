import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { MEDIA_IMAGE_MAX_BYTES } from "@spokkio/shared";
import type { UploadMediaInput, MediaOutput, GetMediaInput, GetMediaOutput } from "@spokkio/shared";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppService } from "../whatsapp/whatsapp.service";

// Margine sotto i ~30 giorni di validità di un media id Meta.
const META_MEDIA_REUSE_MS = 25 * 24 * 60 * 60 * 1000;

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  // Tool: media.upload
  async upload(input: UploadMediaInput): Promise<MediaOutput> {
    const data = Buffer.from(input.dataBase64, "base64");
    if (data.length === 0) throw new BadRequestException("File vuoto o non leggibile");
    if (data.length > MEDIA_IMAGE_MAX_BYTES) {
      throw new BadRequestException("L'immagine supera i 5 MB consentiti da WhatsApp");
    }

    const asset = await this.prisma.mediaAsset.create({
      data: {
        teamId: input.teamId,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: data.length,
        data,
      },
    });
    return this.toOutput(asset);
  }

  // Tool: media.get
  async get(input: GetMediaInput): Promise<GetMediaOutput> {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id: input.mediaId, teamId: input.teamId } });
    if (!asset) throw new NotFoundException("Immagine non trovata");
    return { ...this.toOutput(asset), dataBase64: Buffer.from(asset.data).toString("base64") };
  }

  async assertBelongsToTeam(teamId: string, mediaId: string): Promise<void> {
    const count = await this.prisma.mediaAsset.count({ where: { id: mediaId, teamId } });
    if (count === 0) throw new NotFoundException("Immagine non trovata");
  }

  // Restituisce un media id Meta valido per questo numero, ricaricando
  // l'immagine solo se non c'è ancora o se quello in cache sta per scadere.
  async ensureMetaMediaId(
    mediaId: string,
    connection: { phoneNumberId: string; accessTokenEncrypted: string },
  ): Promise<string> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!asset) throw new NotFoundException("Immagine non trovata");

    const cached =
      asset.metaMediaId &&
      asset.metaPhoneNumberId === connection.phoneNumberId &&
      asset.metaUploadedAt &&
      Date.now() - asset.metaUploadedAt.getTime() < META_MEDIA_REUSE_MS;
    if (cached) return asset.metaMediaId!;

    const metaMediaId = await this.whatsapp.uploadMedia({
      phoneNumberId: connection.phoneNumberId,
      accessToken: connection.accessTokenEncrypted,
      data: Buffer.from(asset.data),
      mimeType: asset.mimeType,
      filename: asset.filename,
    });
    await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { metaMediaId, metaPhoneNumberId: connection.phoneNumberId, metaUploadedAt: new Date() },
    });
    return metaMediaId;
  }

  async getData(mediaId: string): Promise<{ data: Buffer; mimeType: string }> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!asset) throw new NotFoundException("Immagine non trovata");
    return { data: Buffer.from(asset.data), mimeType: asset.mimeType };
  }

  private toOutput(asset: { id: string; filename: string; mimeType: string; sizeBytes: number }): MediaOutput {
    return { id: asset.id, filename: asset.filename, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes };
  }
}
