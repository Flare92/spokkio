import * as readline from "node:readline/promises";
import { PrismaClient } from "@prisma/client";

// Interactive CLI to attach real Meta WhatsApp Cloud API credentials to a
// team, once you have them from developers.facebook.com (see
// docs/SETUP_MAC.md, sezione "Collegare Meta WhatsApp"). Replaces the
// fake connection created by prisma/seed.ts with real ones.
//
// Usage:
//   pnpm --filter @spokkio/api prisma:connect-whatsapp
const prisma = new PrismaClient();

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const teams = await prisma.team.findMany({ include: { users: true } });
  if (teams.length === 0) {
    console.log("Nessun team trovato — registrati prima da http://localhost:3000/onboarding");
    rl.close();
    return;
  }

  console.log("\nTeam disponibili:");
  teams.forEach((t, i) => console.log(`  [${i}] ${t.name} (owner: ${t.users[0]?.email})`));
  const idxRaw = await rl.question("\nSeleziona il numero del team a cui collegare WhatsApp: ");
  const team = teams[Number(idxRaw)];
  if (!team) {
    console.log("Selezione non valida.");
    rl.close();
    return;
  }

  console.log(
    "\nTrovi questi valori in developers.facebook.com -> la tua app -> WhatsApp -> API Setup\n",
  );
  const wabaId = await rl.question("WhatsApp Business Account ID (WABA ID): ");
  const phoneNumberId = await rl.question("Phone number ID: ");
  const displayPhoneNumber = await rl.question("Numero di telefono mostrato (es. +15551234567): ");
  const accessToken = await rl.question(
    "Access token (temporaneo 24h per test, o permanente da un System User): ",
  );

  rl.close();

  await prisma.whatsAppConnection.upsert({
    where: { teamId: team.id },
    update: { wabaId, phoneNumberId, displayPhoneNumber, accessTokenEncrypted: accessToken },
    create: { teamId: team.id, wabaId, phoneNumberId, displayPhoneNumber, accessTokenEncrypted: accessToken },
  });

  console.log(`\n✅ Connessione WhatsApp salvata per il team "${team.name}".`);
  console.log(
    "NOTA: il token è salvato in chiaro nel DB locale — accettabile per test in locale, mai in produzione (vedi docs/RISKS.md).",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
