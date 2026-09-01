import { PrismaClient } from "@prisma/client";

// Local/dev-only seed: creates a WhatsApp connection stub and a
// pre-APPROVED template so the full contacts -> segment -> campaign flow
// can be exercised end-to-end without waiting on Meta's real template
// review or a live WABA. Never run against a production database.
const prisma = new PrismaClient();

async function main() {
  const team = await prisma.team.findFirst();
  if (!team) {
    console.log("No team found — register a team via POST /api/v1/auth/register first, then re-run the seed.");
    return;
  }

  await prisma.whatsAppConnection.upsert({
    where: { teamId: team.id },
    update: {},
    create: {
      teamId: team.id,
      wabaId: "dev-waba-id",
      phoneNumberId: "dev-phone-number-id",
      displayPhoneNumber: "+390000000000",
      accessTokenEncrypted: "dev-access-token",
    },
  });

  await prisma.template.create({
    data: {
      teamId: team.id,
      name: "promemoria_appuntamento_dev",
      category: "UTILITY",
      language: "it",
      bodyText: "Ciao! Ti ricordiamo il tuo appuntamento di oggi.",
      status: "APPROVED",
    },
  });

  console.log(`Seeded WhatsApp connection + APPROVED template for team ${team.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
