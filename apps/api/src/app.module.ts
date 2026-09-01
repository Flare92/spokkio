import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { ContactsModule } from "./contacts/contacts.module";
import { TemplatesModule } from "./templates/templates.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { InboxModule } from "./inbox/inbox.module";
import { AutomationsModule } from "./automations/automations.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { BillingModule } from "./billing/billing.module";
import { WhatsAppModule } from "./whatsapp/whatsapp.module";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    WhatsAppModule,
    ContactsModule,
    TemplatesModule,
    CampaignsModule,
    InboxModule,
    AutomationsModule,
    AnalyticsModule,
    BillingModule,
  ],
})
export class AppModule {}
