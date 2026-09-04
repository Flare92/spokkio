# Changelog

## Fase 1.1 — Uso reale in locale (2026-09-04)

Primo giro di lavoro guidato dall'uso vero del prodotto sul Mac del founder.

### Aggiunto

- **Spokkio.app**: app macOS avviabile con doppio click che fa partire
  database, API e interfaccia e apre il browser, senza terminale. Si allinea
  da sola dopo un aggiornamento del codice (`scripts/build-mac-app.sh`).
- **Import contatti da file**: CSV (separatore autorilevato) ed Excel, con
  mappatura colonne proposta in automatico, normalizzazione dei numeri a
  E.164, anteprima delle righe valide/scartate, import a blocchi e colonne
  extra conservate come campi personalizzati.
- **Campaign manager**: variabili di template mappabili su campi contatto,
  campi personalizzati o testo fisso (con valore di riserva), anteprima del
  messaggio sui destinatari reali, invio programmato con scheduler e
  annullamento, elenco campagne con stato.
- **Dashboard analytics**: KPI di periodo, andamento giornaliero con
  tooltip, imbuto di consegna, scomposizione dei costi per categoria e
  tabella per campagna con drill-down a evento singolo.
- **Impostazioni WhatsApp nella UI**: collegamento del numero senza passare
  dalla riga di comando, con verifica immediata della validità del token
  (i token temporanei di Meta scadono dopo 24 ore).

### Corretto

- L'API andava in crash all'avvio su Node 24: `packages/shared` è ora
  consumato dalla build compilata invece che dai sorgenti TypeScript.
- Il simulatore di costo usava sempre la categoria MARKETING, facendo
  fallire l'invio delle campagne con template di categoria diversa.
- Lo script di setup su macOS non sopravviveva a un post-install fallito di
  PostgreSQL e generava una stringa di connessione senza utente.

## Fase 1 — MVP scaffold (2026-09-01)

Primo commit: scaffold completo del monorepo e flusso verticale end-to-end
"importa contatti → segmenta → crea template → simula costo → invia campagna
→ vedi analytics", più inbox condivisa e 3 automazioni pronte all'uso per il
verticale servizi locali.

### Aggiunto

- Monorepo pnpm: `apps/api` (NestJS), `apps/web` (Next.js), `packages/shared` (schemi Zod + registry dei tool).
- Modello dati Prisma: Team/User multi-tenant, Contact/Segment, Template, Campaign/Message, Conversation, Automation/AutomationRun, Appointment, AttributionEvent, Subscription/UsagePeriod.
- Auth: registrazione team + login JWT, `TeamScopeGuard` per isolamento multi-tenant su ogni endpoint.
- Integrazione WhatsApp Cloud API diretta (Meta, no BSP): invio template, invio testo libero in finestra 24h, coda rate-limited con backoff esponenziale, webhook per stati di consegna, messaggi in ingresso e stato template (approvato/rifiutato).
- Contatti: import, tagging, segmentazione a regola esplicita (no black-box).
- Template: creazione (stato `PENDING_REVIEW` finché Meta non conferma via webhook).
- Campagne: simulatore di costo trasparente (costo Meta + markup dichiarato, sempre come righe separate) obbligatorio prima dell'invio; invio broadcast con tracking per-messaggio.
- Inbox condivisa multi-operatore con assegnazione automatica al primo che risponde.
- 3 automazioni pronte all'uso (promemoria appuntamento, follow-up post-visita, richiamo cliente inattivo) valutate da uno scheduler cron ogni 5 minuti, con guardia di idempotenza (`AutomationRun`).
- Analytics: statistiche per campagna con drill-down a evento singolo.
- Frontend: onboarding guidato in 2 passi, contatti/segmenti, campagne (con simulatore di costo), inbox, analytics.

### Non incluso in questo commit (rimandato)

Vedi `docs/RISKS.md`.
