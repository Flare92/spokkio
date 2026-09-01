# Rischi e debiti tecnici aperti — dopo lo scaffold Fase 1

## Sicurezza / produzione (bloccanti prima del go-live)

- **Access token WhatsApp in chiaro.** `WhatsAppConnection.accessTokenEncrypted` è salvato come stringa semplice: va cifrato con un KMS (es. AWS/GCP KMS o Supabase Vault) prima di qualsiasi dato reale.
- **Nessun rate limiting / CAPTCHA su `/auth/register` e `/auth/login`.** Necessario prima dell'esposizione pubblica.
- **Multi-WABA non gestito nel webhook.** `WebhookIngestService.handleInboundMessage` assume un solo WABA per l'intera installazione (matcha il contatto solo per numero di telefono, non per `phone_number_id`) — da correggere se un domani si servono più team con numeri diversi sullo stesso deployment.

## Correttezza funzionale

- **Import contatti solo riga-per-riga dalla UI.** Il tool `contacts.import` accetta CSV/Google Sheets nello schema, ma il parsing file reale (upload CSV, OAuth Google Sheets) non è implementato in `apps/web` — oggi si può solo aggiungere un contatto alla volta dalla dashboard.
- **Onboarding "wizard con AI conversazionale"** richiesto dal documento di prodotto non è implementato: l'onboarding attuale è un form guidato in 2 passi, senza assistente conversazionale. È il gap più visibile rispetto alla visione §7.3 del master prompt.
- **Integrazione Shopify/WooCommerce/Google Sheets/Zapier** (richiesta in Fase 1) non ancora costruita — nessun modulo dedicato esiste ancora.
- **Rate card Meta hardcoded** in `apps/api/src/campaigns/pricing.ts` — va sincronizzata periodicamente con il listino ufficiale Meta (cambia nel tempo) o resa configurabile da un pannello admin.
- **Cambi di piano/prezzo con preavviso ≥7 giorni**: lo schema (`Subscription.pendingChangeEffectiveAt`) esiste ma non c'è ancora nessun flusso che programmi o notifichi un cambio piano.
- **Dashboard "clienti a rischio"** per il team di supporto (da §5 del documento di analisi) non implementata.

## Test

- Nessun test automatico ancora scritto. Prioritario prima di ogni release: test di integrazione sul flusso campagne (estimate → create → send con mock di Meta Cloud API) e sul webhook ingest (idempotenza, stati di consegna).
- Nessun test di sync bidirezionale CRM — normale, perché nessuna integrazione CRM esiste ancora in Fase 1, ma è un requisito esplicito del documento di prodotto per quando arriveranno HubSpot/Salesforce/ActiveCampaign in Fase 2.

## Infrastruttura

- `DATABASE_URL` punta a un Postgres da provisionare (Supabase EU) — nessun ambiente reale è ancora collegato.
- Nessuna pipeline CI/CD configurata.
- Il deploy previsto (Vercel per il web, Fly.io/Render EU per l'API) non è ancora impostato.

## Prossimi passi consigliati

1. Provisionare Postgres EU (Supabase) e far girare `prisma migrate dev` in un ambiente reale.
2. Registrare un WABA Meta di test e collegarlo (sostituendo il seed di sviluppo).
3. Costruire l'import CSV reale in UI.
4. Aggiungere test di integrazione sul flusso campagne prima di procedere a Fase 2.
