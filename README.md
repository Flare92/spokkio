# Spokkio

Piattaforma SaaS di WhatsApp Business Marketing & Customer Engagement per PMI italiane/EU — servizi locali (beauty & wellness, ristorazione) come primo verticale.

Progetto indipendente, separato da ogni altro gestionale in questo account.

## Differenziazione (vincoli di prodotto non negoziabili)

1. **Un solo piano, una fattura, nessun wallet doppio.** Il costo Meta per conversazione è sempre mostrato come riga separata dal markup dichiarato (vedi `apps/api/src/campaigns/pricing.ts`).
2. **Nessun overage a sorpresa.** Alert proattivo all'80% della soglia inclusa (`Subscription.usageAlertThresholdPct`), mai un blocco improvviso.
3. **Ogni feature è un tool esposto in modo pulito** — vedi `packages/shared/src/tools/registry.ts` — non solo un bottone in UI (architettura MCP-native da subito, layer MCP pubblico previsto in Fase 3).
4. **Ogni claim analitico è ispezionabile.** Ogni statistica aggregata in `analytics.campaignStats` ha un drill-down a evento singolo in `analytics.campaignEventDrilldown`.
5. **Segmentazione trasparente.** Nessun ML a scatola nera: i segmenti sono regole esplicite su tag (`matchTags` / `matchMode`).

## Decisioni architetturali (confermate con il founder)

| Bivio | Scelta |
|---|---|
| Accesso WhatsApp Cloud API | Meta Cloud API diretta (no BSP) |
| Hosting / data residency EU | Supabase (Postgres EU) + Fly.io/Render (EU) + Vercel |
| Verticale go-to-market Fase 1 | Servizi locali (beauty & wellness, ristorazione) — priorità booking/calendario |
| Esposizione layer MCP | Solo interno fino a Fase 3 |

## Stack

- **Backend**: NestJS + TypeScript, Prisma/PostgreSQL, Zod per gli schemi dei tool.
- **Frontend**: Next.js (App Router) + TypeScript + Tailwind.
- **Automazioni**: scheduler basato su cron (`@nestjs/schedule`) che valuta i 3 trigger pronti all'uso ogni 5 minuti.
- **WhatsApp**: integrazione diretta Meta Cloud API con coda rate-limited e webhook per stati di consegna/template.

## Struttura del monorepo

```
apps/
  api/       NestJS — logica di business, ogni azione esposta come "tool" (schema Zod condiviso)
  web/       Next.js — dashboard che chiama gli stessi tool dell'API (dog-fooding)
packages/
  shared/    Schemi Zod + registry dei tool, fonte di verità unica per input/output di ogni azione
```

## Modello dati essenziale

Team (multi-tenant) → User, Contact, Segment, Template, Campaign, Conversation/Message, Automation, AttributionEvent, Subscription/UsagePeriod. Vedi `apps/api/prisma/schema.prisma`.

## Sviluppo locale

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # configura DATABASE_URL (Postgres) e JWT_SECRET
cp apps/web/.env.example apps/web/.env.local

cd apps/api
npx prisma migrate dev --name init
pnpm dev                                  # API su :3001

# in un altro terminale
pnpm --filter @spokkio/web dev            # Web su :3000
```

Per testare il flusso end-to-end senza un WABA reale:
1. Registra un team da `/onboarding` (o `POST /api/v1/auth/register`).
2. Esegui `pnpm --filter @spokkio/api prisma:seed` — crea una connessione WhatsApp fittizia e un template già `APPROVED` (in produzione l'approvazione arriva solo via webhook Meta).
3. Da `/contacts` aggiungi un contatto e crea un segmento; da `/campaigns` simula il costo e crea/invia la campagna.

## Flusso verticale Fase 1 implementato

Onboarding guidato → import contatti + segmentazione a tag → creazione template → simulatore di costo trasparente → creazione e invio campagna broadcast → inbox condivisa multi-operatore → analytics con drill-down → 3 automazioni pronte all'uso (promemoria appuntamento, follow-up post-visita, richiamo cliente inattivo).

Vedi `docs/CHANGELOG.md` per il dettaglio fase per fase e `docs/RISKS.md` per debiti tecnici e rischi aperti.
