import { Module } from "@nestjs/common";
import { TemplatesService } from "./templates.service";
import { TemplatesController } from "./templates.controller";
import { WhatsAppModule } from "../whatsapp/whatsapp.module";
import { MediaModule } from "../media/media.module";

@Module({
  imports: [WhatsAppModule, MediaModule],
  providers: [TemplatesService],
  controllers: [TemplatesController],
  exports: [TemplatesService],
})
export class TemplatesModule {}
