# Setup su macOS

Guida per scaricare, installare e usare Spokkio in locale sul tuo Mac, incluso il collegamento a un numero WhatsApp reale (di test, gratuito) tramite Meta.

Per la parte Meta con tutti i link diretti (creazione app, credenziali, migrazione del tuo numero aziendale esistente, verifica azienda, token permanente, webhook) vedi la guida dedicata **`docs/META_SETUP.md`** — qui sotto trovi solo la versione sintetica per il primo test con il numero gratuito.

## 0. Cosa ti serve prima di iniziare

- Un Mac con macOS (Intel o Apple Silicon, va bene entrambi)
- Un account Facebook personale (per accedere a Meta for Developers) — se non ce l'hai, creane uno gratuito
- ~20 minuti

Non ti serve: carta di credito, numero di telefono business dedicato, abbonamento a pagamento. Tutto quello che segue è gratuito.

## 1. Scarica il progetto

Apri l'app **Terminale** (Cmd+Spazio, scrivi "Terminale") e incolla:

```bash
git clone https://github.com/Flare92/spokkio.git
cd spokkio
git checkout claude/spokkio-new-project-fv7d10
```

Se non hai `git` installato, il Mac ti proporrà di installare gli "Strumenti da riga di comando per gli sviluppatori Xcode": accetta, poi ripeti il comando.

## 2. Esegui lo script di setup

```bash
chmod +x scripts/setup-mac.sh
./scripts/setup-mac.sh
```

Questo script (puoi aprirlo con un editor di testo per vedere esattamente cosa fa, è commentato in italiano):

1. Installa Homebrew se non c'è già (ti chiederà la password del Mac)
2. Installa Node.js 20, pnpm, PostgreSQL, ngrok
3. Crea e avvia un database Postgres locale chiamato `spokkio`
4. Crea `apps/api/.env` e `apps/web/.env.local` generando in automatico un JWT secret casuale
5. Installa tutte le dipendenze del progetto (`pnpm install`)
6. Applica lo schema del database (`prisma migrate dev`)

Alla fine vedrai `✅ Setup completato.`

Se qualcosa fallisce a metà, puoi rilanciare lo script: è pensato per essere eseguito più volte senza rompere nulla (non sovrascrive `.env` se esiste già).

## 3. Collegare Meta WhatsApp (numero di test gratuito)

Questa è la parte "Meta". La facciamo per gradi.

### 3.1 Crea l'app su Meta for Developers

1. Vai su **[developers.facebook.com/apps](https://developers.facebook.com/apps/)** e accedi con il tuo account Facebook
2. **Crea app**
3. Tipo di app: scegli **"Business"**
4. Dai un nome all'app (es. "Spokkio Dev") e conferma — Meta crea in automatico anche un **Meta Business Account** gratuito se non ne hai già uno, non serve fare nulla di manuale
5. Nella dashboard dell'app, cerca il prodotto **WhatsApp** nella lista e clicca **Configura**

### 3.2 Prendi le credenziali di test

Dopo aver aggiunto il prodotto WhatsApp, Meta ti porta in una pagina **"Guida introduttiva" / "API Setup"** dove trovi già pronti, senza dover verificare nulla:

- Un **numero di telefono di test** gratuito, di proprietà di Meta (es. "+1 555 xxx xxxx")
- Il suo **Phone number ID**
- Il **WhatsApp Business Account ID (WABA ID)**
- Un **access token temporaneo** (valido 24 ore — perfetto per i primi test, poi vedremo come renderlo permanente)

Segna questi 4 valori da qualche parte, ti serviranno tra un minuto.

### 3.3 Aggiungi il tuo numero come destinatario di test

Con il numero di test gratuito puoi inviare messaggi **solo** verso numeri che registri esplicitamente come destinatari di test (massimo 5):

1. Nella stessa pagina "API Setup", sezione **"To"**, clicca **Manage phone number list**
2. Aggiungi il tuo numero WhatsApp personale (quello che usi normalmente) — Meta ti manda un codice OTP via WhatsApp per verificarlo
3. Da questo momento puoi ricevere messaggi di test dall'app direttamente sulla tua WhatsApp personale

### 3.4 Collega le credenziali a Spokkio

Con i server ancora spenti, apri un terminale nella cartella del progetto:

```bash
pnpm --filter @spokkio/api prisma:connect-whatsapp
```

Lo script ti chiede: quale team collegare (devi già esserti registrato una volta da `/onboarding`, vedi punto 4 sotto se non l'hai ancora fatto), poi i 4 valori del punto 3.2. Li incolli e la connessione è salvata.

> Nota: per i test locali il token va bene anche quello temporaneo da 24h — quando scade, rilanci lo stesso comando con un token fresco preso dalla stessa pagina Meta. Per un token permanente: Meta Business Suite → Impostazioni azienda → Utenti di sistema → crea un System User con permesso `whatsapp_business_messaging` e genera un token senza scadenza.

### 3.5 (Opzionale, solo se vuoi testare risposte in arrivo) Collega il webhook

Il webhook serve per ricevere in Spokkio le conferme di consegna/lettura e i messaggi che le persone ti scrivono. Per riceverlo in locale serve esporre il tuo Mac a internet temporaneamente, con `ngrok` (già installato dallo script):

```bash
ngrok http 3001
```

Ngrok ti dà un indirizzo tipo `https://abcd1234.ngrok-free.app`. Poi:

1. Su developers.facebook.com → la tua app → WhatsApp → **Configurazione**
2. **Modifica** la sezione Webhook, inserisci:
   - Callback URL: `https://abcd1234.ngrok-free.app/api/v1/webhooks/whatsapp`
   - Verify token: il valore di `WHATSAPP_WEBHOOK_VERIFY_TOKEN` che trovi in `apps/api/.env` (generato automaticamente dallo script di setup)
3. Iscriviti almeno ai campi `messages` e `message_template_status_update`

Nota: ogni volta che riavvii `ngrok` l'URL cambia, e devi aggiornarlo su Meta. Per un uso più stabile in locale puoi registrare un account ngrok gratuito e usare un dominio fisso.

## 4. Avvia Spokkio

Apri **due** finestre di Terminale nella cartella del progetto:

```bash
# Terminale 1
pnpm --filter @spokkio/api dev
```

```bash
# Terminale 2
pnpm --filter @spokkio/web dev
```

Apri il browser su **http://localhost:3000/onboarding** e crea il tuo primo account (nome attività, email, password). Verrai portato alla dashboard.

Poi:
1. Se non l'hai ancora fatto, torna al punto 3.4 per collegare WhatsApp a questo team appena creato
2. Da **Contatti**, aggiungi il tuo numero personale (quello registrato come destinatario di test) e taggalo, es. `test`
3. Crea un **Segmento** che matcha il tag `test`
4. Da **Campagne**, crea un template — attenzione: un template nuovo deve prima essere **approvato da Meta** (ci mette da pochi minuti a qualche ora) prima di poterlo usare in una campagna. Lo stato lo vedi accanto al nome del template nella pagina Campagne, si aggiorna da solo quando arriva il webhook di approvazione (serve il punto 3.5 per riceverlo automaticamente; in alternativa controlla lo stato direttamente su developers.facebook.com → WhatsApp → Gestione modelli di messaggio)
5. Simula il costo, crea la campagna e inviala — dovresti ricevere il messaggio reale sul tuo WhatsApp

## Limiti del numero di test gratuito (da sapere)

- Puoi inviare solo verso i numeri che hai registrato come destinatari (max 5)
- Il numero di test **non è tuo** — non puoi usarlo con clienti veri, serve solo per sviluppo
- Quando sarai pronto a lanciare con clienti reali, dovrai collegare il tuo numero aziendale (nuovo, oppure quello già usato su WhatsApp Business App tramite migrazione) e in genere passare per la verifica dell'azienda per alzare i limiti di invio — passaggi dettagliati con tutti i link in **`docs/META_SETUP.md`** (sezioni 4 e 5), non servono per i test in locale

## Problemi comuni

- **`createdb: command not found`** dopo l'installazione di Postgres: chiudi e riapri il Terminale, oppure esegui `eval "$(/opt/homebrew/bin/brew shellenv)"`.
- **La porta 3000 o 3001 è già occupata**: chiudi l'altro processo o cambia porta con `PORT=3002 pnpm --filter @spokkio/api dev`.
- **Il token è scaduto (errore 401 da Meta)**: rigenera il token temporaneo dalla pagina "API Setup" e rilancia `prisma:connect-whatsapp`.
- **Il template resta su `PENDING_REVIEW`**: senza il webhook (punto 3.5) collegato, Spokkio non riceve l'aggiornamento automatico — puoi comunque verificare lo stato reale su Meta e, se vuoi sbloccarti subito per un test rapido, aggiornare lo stato a mano nel database locale con uno strumento come Postico/TablePlus, oppure collegare ngrok.
