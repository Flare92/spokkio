import { Module } from "@nestjs/common";
import { InboxService } from "./inbox.service";
import { InboxController } from "./inbox.controller";
import { WhatsAppModule } from "../whatsapp/whatsapp.module";

@Module({
  imports: [WhatsAppModule],
  providers: [InboxService],
  controllers: [InboxController],
  exports: [InboxService],
})
export class InboxModule {}
