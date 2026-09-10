import { Module } from "@nestjs/common";
import { ContactsService } from "./contacts.service";
import { ContactsController } from "./contacts.controller";
import { GoogleSheetService } from "./google-sheet.service";

@Module({
  providers: [ContactsService, GoogleSheetService],
  controllers: [ContactsController],
  exports: [ContactsService],
})
export class ContactsModule {}
