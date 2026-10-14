import { Module } from "@nestjs/common";
import { MediaService } from "./media.service";
import { MediaController } from "./media.controller";
import { WhatsAppModule } from "../whatsapp/whatsapp.module";

@Module({
  imports: [WhatsAppModule],
  providers: [MediaService],
  controllers: [MediaController],
  exports: [MediaService],
})
export class MediaModule {}
