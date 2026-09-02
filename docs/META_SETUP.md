# Meta for Developers — guida passo-passo con link diretti

Guida solo per la parte Meta (creazione app, credenziali, numero di test, migrazione del numero esistente, verifica azienda, token permanente, webhook). Per il setup del progetto sul Mac vedi `docs/SETUP_MAC.md`.

> Nota: Meta rinomina/sposta occasionalmente le pagine della sua documentazione. Se un link sotto risulta rotto, il percorso descritto accanto (dove cliccare) resta valido — cerca il titolo indicato nella barra di ricerca della pagina che si apre.

## 1. Crea l'app

- Vai su **[developers.facebook.com/apps](https://developers.facebook.com/apps/)**
- Accedi con il tuo account Facebook personale
- **Crea app** → tipo **"Business"** → dai un nome (es. "Spokkio") → conferma
- Meta crea in automatico anche un Meta Business Account gratuito se non ne hai già uno

## 2. Aggiungi il prodotto WhatsApp e prendi le credenziali di test

- Nella dashboard della tua app appena creata, cerca la card **WhatsApp** e clicca **Configura/Set up**
- Guida ufficiale di riferimento: **[developers.facebook.com/docs/whatsapp/cloud-api/get-started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)**
- Nella pagina **"API Setup"** che si apre trovi già pronti, senza dover verificare nulla:
  - **Numero di telefono di test** (di Meta)
  - **Phone number ID**
  - **WhatsApp Business Account ID (WABA ID)**
  - **Access token temporaneo** (24 ore)

## 3. Aggiungi il tuo numero come destinatario di test

- Sempre nella pagina "API Setup", sezione **"To"** → **Manage phone number list**
- Aggiungi il tuo numero WhatsApp personale, verifica via OTP — ora puoi ricevere messaggi di test

## 4. (Quando sarai pronto) Collega il tuo numero aziendale esistente

Questo è il passaggio che sposta il numero che usi già su WhatsApp Business App verso la Cloud API — fallo solo dopo aver validato tutto con il numero di test (vedi la nostra chat precedente sui rischi).

- Guida ufficiale sulla migrazione: **[developers.facebook.com/docs/whatsapp/cloud-api/guides/migrate-existing-whatsapp-number-to-a-business-account](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/migrate-existing-whatsapp-number-to-a-business-account)** (se il link è cambiato, cerca "Migrate Existing WhatsApp Number to a Business Account" nella documentazione Cloud API)
- Nella pagina "API Setup" della tua app, invece del numero di test scegli **Aggiungi numero di telefono** e inserisci il tuo numero aziendale
- Meta rileva che è già attivo su WhatsApp Business App e ti guida nel flusso di migrazione (verifica via SMS o chiamata vocale)
- Dopo la conferma, l'app WhatsApp Business sul telefono si disconnette da quel numero: la messaggistica passa da lì in poi attraverso Spokkio

## 5. Verifica dell'azienda (per alzare i limiti di invio)

Necessaria per inviare oltre ai 5 destinatari di test e per volumi di campagne marketing reali.

- Vai su **[business.facebook.com](https://business.facebook.com/)** → icona ingranaggio in alto → **Impostazioni azienda**
- Menu laterale → **Centro sicurezza** → **Avvia verifica**
- Ti verranno richiesti documenti aziendali (visura camerale/certificato di iscrizione, partita IVA, ecc.)
- Pagina di riferimento generale: **[developers.facebook.com/docs/development/release/business-verification](https://developers.facebook.com/docs/development/release/business-verification)**

## 6. Token permanente (System User)

Il token temporaneo dura 24 ore — per uso continuativo serve un token da un System User, che non scade.

- Su **[business.facebook.com/settings](https://business.facebook.com/settings/)** → **Utenti di sistema** → **Aggiungi**
- Crea un System User con ruolo Admin, assegnalo alla tua app WhatsApp
- Genera un token con permesso **`whatsapp_business_messaging`** (e `whatsapp_business_management` se vuoi gestire i template da API)
- Guida ufficiale: **[developers.facebook.com/docs/marketing-api/system-users/create-manage](https://developers.facebook.com/docs/marketing-api/system-users/create-manage)**

## 7. Webhook (per ricevere messaggi e stati di consegna)

- Nella dashboard della tua app → **WhatsApp → Configurazione**
- Guida ufficiale: **[developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks)**
- Callback URL: il tuo endpoint ngrok + `/api/v1/webhooks/whatsapp` (es. `https://abcd1234.ngrok-free.app/api/v1/webhooks/whatsapp`)
- Verify token: il valore di `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in `apps/api/.env`
- Iscriviti almeno ai campi `messages` e `message_template_status_update`
- ngrok: **[ngrok.com](https://ngrok.com/)** → scarica e, per un authtoken permanente, **[dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)**

## 8. Collega tutto a Spokkio

Una volta ottenuti WABA ID, Phone number ID, numero e access token (di test o permanente):

```bash
pnpm --filter @spokkio/api prisma:connect-whatsapp
```

## Riferimenti rapidi

| Cosa | Link |
|---|---|
| Le tue app | [developers.facebook.com/apps](https://developers.facebook.com/apps/) |
| Documentazione Cloud API | [developers.facebook.com/docs/whatsapp/cloud-api/overview](https://developers.facebook.com/docs/whatsapp/cloud-api/overview) |
| Prezzi per conversazione (da tenere sincronizzati con `apps/api/src/campaigns/pricing.ts`) | [developers.facebook.com/docs/whatsapp/pricing](https://developers.facebook.com/docs/whatsapp/pricing) |
| Meta Business Suite | [business.facebook.com](https://business.facebook.com/) |
| Gestione modelli di messaggio (template) | dentro business.facebook.com → **Account WhatsApp** → **Modelli di messaggio** |
