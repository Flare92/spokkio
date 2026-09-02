#!/usr/bin/env bash
# Spokkio — setup guidato per macOS.
# Esegui questo script DENTRO alla cartella del repo clonato sul tuo Mac:
#   chmod +x scripts/setup-mac.sh
#   ./scripts/setup-mac.sh
#
# Cosa fa:
#  1. Verifica/installa Homebrew, Node, pnpm, Postgres, ngrok
#  2. Avvia Postgres locale e crea il database "spokkio"
#  3. Crea apps/api/.env e apps/web/.env.local dai rispettivi .env.example
#     (chiede solo il minimo indispensabile: JWT secret generato in automatico)
#  4. Installa le dipendenze del monorepo e genera il client Prisma
#  5. Applica le migrazioni al database
#
# Non tocca le credenziali Meta: quelle le inserisci tu a mano in
# apps/api/.env dopo aver seguito docs/SETUP_MAC.md (sezione Meta).

set -euo pipefail

say() { printf "\n\033[1;32m==>\033[0m %s\n" "$1"; }
warn() { printf "\033[1;33m!! \033[0m %s\n" "$1"; }

if [[ "$(uname)" != "Darwin" ]]; then
  warn "Questo script è pensato per macOS. Su altri sistemi segui docs/SETUP_MAC.md a mano."
fi

# --- 1. Homebrew ------------------------------------------------------------
if ! command -v brew &>/dev/null; then
  say "Homebrew non trovato: lo installo (ti verrà chiesta la password di sistema)"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
else
  say "Homebrew già presente"
fi

# --- 2. Node.js (>=20) --------------------------------------------------------
if ! command -v node &>/dev/null || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 20 ]]; then
  say "Installo Node.js 20 via Homebrew"
  brew install node@20
  brew link --overwrite --force node@20
else
  say "Node.js già presente ($(node -v))"
fi

# --- 3. pnpm ------------------------------------------------------------------
if ! command -v pnpm &>/dev/null; then
  say "Abilito pnpm via corepack"
  corepack enable
  corepack prepare pnpm@10.33.0 --activate
else
  say "pnpm già presente ($(pnpm -v))"
fi

# --- 4. PostgreSQL locale ------------------------------------------------------
# postgresql@16 è "keg-only" (non viene linkato in /usr/local/bin di default),
# quindi i suoi binari (psql, createdb, pg_isready...) vanno sempre cercati qui,
# non solo la prima volta che lo installiamo.
export PATH="/opt/homebrew/opt/postgresql@16/bin:/usr/local/opt/postgresql@16/bin:$PATH"

if ! command -v psql &>/dev/null; then
  say "Installo PostgreSQL 16 via Homebrew"
  if ! brew install postgresql@16; then
    # Su macOS meno recenti (compilazione da sorgente) capita che il passo di
    # post-install fallisca pur avendo installato il pacchetto: senza questo
    # fallback lo script si fermerebbe qui per via di 'set -e'.
    warn "Il post-install di postgresql@16 ha avuto un problema, riprovo con 'brew postinstall'"
    brew postinstall postgresql@16
  fi
fi

say "Avvio il servizio PostgreSQL"
brew services start postgresql@16 2>/dev/null || true

say "Attendo che PostgreSQL sia pronto ad accettare connessioni"
for i in $(seq 1 15); do
  if pg_isready -q 2>/dev/null; then
    break
  fi
  sleep 1
done

say "Creo il database 'spokkio' (se non esiste già)"
if ! createdb spokkio 2>/tmp/spokkio-createdb.err; then
  if grep -q "already exists" /tmp/spokkio-createdb.err; then
    warn "Il database 'spokkio' esiste già, ok."
  else
    warn "Creazione del database fallita, dettagli:"
    cat /tmp/spokkio-createdb.err >&2
    exit 1
  fi
fi
rm -f /tmp/spokkio-createdb.err

# --- 5. ngrok (serve per il webhook Meta in locale) ----------------------------
if ! command -v ngrok &>/dev/null; then
  say "Installo ngrok via Homebrew (ti servirà per collegare i webhook Meta)"
  brew install ngrok
else
  say "ngrok già presente"
fi

# --- 6. File .env ---------------------------------------------------------------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_ENV="$ROOT_DIR/apps/api/.env"
WEB_ENV="$ROOT_DIR/apps/web/.env.local"

if [[ ! -f "$API_ENV" ]]; then
  say "Creo apps/api/.env"
  cp "$ROOT_DIR/apps/api/.env.example" "$API_ENV"
  JWT_SECRET=$(openssl rand -hex 32)
  VERIFY_TOKEN=$(openssl rand -hex 16)
  # macOS sed richiede un'estensione di backup esplicita dopo -i
  sed -i '' "s#^DATABASE_URL=.*#DATABASE_URL=\"postgresql://localhost:5432/spokkio?schema=public\"#" "$API_ENV"
  sed -i '' "s#^JWT_SECRET=.*#JWT_SECRET=\"$JWT_SECRET\"#" "$API_ENV"
  sed -i '' "s#^WHATSAPP_WEBHOOK_VERIFY_TOKEN=.*#WHATSAPP_WEBHOOK_VERIFY_TOKEN=\"$VERIFY_TOKEN\"#" "$API_ENV"
  say "Generati JWT_SECRET e WHATSAPP_WEBHOOK_VERIFY_TOKEN casuali in apps/api/.env"
else
  warn "apps/api/.env esiste già, non lo tocco"
fi

if [[ ! -f "$WEB_ENV" ]]; then
  say "Creo apps/web/.env.local"
  cp "$ROOT_DIR/apps/web/.env.example" "$WEB_ENV"
else
  warn "apps/web/.env.local esiste già, non lo tocco"
fi

# --- 7. Dipendenze + Prisma -----------------------------------------------------
say "Installo le dipendenze del monorepo (pnpm install)"
cd "$ROOT_DIR"
pnpm install

say "Genero il client Prisma"
pnpm --filter @spokkio/api exec prisma generate

say "Applico le migrazioni al database locale"
pnpm --filter @spokkio/api exec prisma migrate dev --name init

cat <<'EOF'

✅ Setup completato.

Prossimi passi:
  1. Segui docs/SETUP_MAC.md (sezione "Collegare Meta WhatsApp") per ottenere
     access token, phone_number_id e WABA id, e incollarli in apps/api/.env
     tramite il seed di sviluppo (o direttamente nel database).
  2. Avvia i due server in due terminali separati:
       pnpm --filter @spokkio/api dev     # http://localhost:3001
       pnpm --filter @spokkio/web dev     # http://localhost:3000
  3. Apri http://localhost:3000/onboarding e crea il tuo primo account.

EOF
