import * as readline from "node:readline/promises";
import { PrismaClient } from "@prisma/client";

// Ogni numero di test gratuito di Meta arriva con un template già
// pre-approvato chiamato "hello_world" (categoria UTILITY, lingua en_US) —
// pensato apposta da Meta per poter testare l'invio subito, senza aspettare
// la review di un template personalizzato (che Spokkio oggi crea sempre in
// stato PENDING_REVIEW, vedi templates.service.ts: la sottomissione reale a
// Meta non è ancora implementata, l'approvazione arriva solo via webhook —
// quindi per "hello_world", che Meta ha già approvato da sé, il webhook non
// arriverà mai perché non l'abbiamo sottomesso noi).
//
// Questo script crea (o corregge) il record locale del template
// "hello_world" e lo marca subito come APPROVED, così puoi creare una
// campagna di test reale nel giro di un minuto.
//
// Usage:
//   pnpm --filter @spokkio/api prisma:quick-test-template
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
  const idxRaw = await rl.question("\nSeleziona il numero del team: ");
  const team = teams[Number(idxRaw)];
  rl.close();

  if (!team) {
    console.log("Selezione non valida.");
    return;
  }

  const existing = await prisma.template.findFirst({ where: { teamId: team.id, name: "hello_world" } });

  const template = existing
    ? await prisma.template.update({
        where: { id: existing.id },
        data: { status: "APPROVED", category: "UTILITY", language: "en_US" },
      })
    : await prisma.template.create({
        data: {
          teamId: team.id,
          name: "hello_world",
          category: "UTILITY",
          language: "en_US",
          bodyText: "Hello World, Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API.",
          status: "APPROVED",
        },
      });

  console.log(`\n✅ Template "hello_world" pronto (id: ${template.id}, stato: APPROVED).`);
  console.log("Usalo subito in una campagna di test da /campaigns.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
