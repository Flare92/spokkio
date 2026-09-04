#!/usr/bin/env bash
# Avvia Spokkio in locale (Postgres + API + Web) e apre il browser.
# Viene richiamato da Spokkio.app: non serve lanciarlo a mano.
#
# Restano in esecuzione due processi (API e Web); quando questo script viene
# terminato, entrambi vengono chiusi.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOME/Library/Logs/Spokkio"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/spokkio.log"

log() { printf "[%s] %s\n" "$(date '+%H:%M:%S')" "$1" | tee -a "$LOG_FILE"; }

# I binari di Homebrew e di postgresql@16 (keg-only) non sono nel PATH di
# un'app avviata dal Finder, che non carica il profilo della shell.
export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/local/opt/postgresql@16/bin:$PATH"

cleanup() {
  log "Arresto Spokkio..."
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null
  wait 2>/dev/null
  log "Spokkio arrestato."
}
trap cleanup EXIT INT TERM

log "Avvio Spokkio da $ROOT_DIR"

# --- Postgres ---------------------------------------------------------------
if ! pg_isready -q 2>/dev/null; then
  log "Avvio PostgreSQL..."
  brew services start postgresql@16 >>"$LOG_FILE" 2>&1
  for _ in $(seq 1 20); do
    pg_isready -q 2>/dev/null && break
    sleep 1
  done
fi

if ! pg_isready -q 2>/dev/null; then
  log "ERRORE: PostgreSQL non risponde. Controlla $LOG_FILE"
  osascript -e 'display alert "Spokkio" message "PostgreSQL non si è avviato. Controlla il log in ~/Library/Logs/Spokkio/spokkio.log"' 2>/dev/null
  exit 1
fi

# --- Build ------------------------------------------------------------------
# Passi rapidi e idempotenti eseguiti sempre: così dopo un "git pull" l'app si
# allinea da sola senza che tu debba ricordarti nulla dal terminale.
# Lo schema viene sincronizzato con "db push" invece che con le migrazioni:
# aggiunge le colonne nuove preservando i dati già presenti in locale.
cd "$ROOT_DIR"
log "Allineo pacchetto condiviso e schema del database..."
pnpm --filter @spokkio/shared build >>"$LOG_FILE" 2>&1
pnpm --filter @spokkio/api exec prisma generate >>"$LOG_FILE" 2>&1
pnpm --filter @spokkio/api exec prisma db push --skip-generate >>"$LOG_FILE" 2>&1

# Le build pesanti girano solo se mancano o se il codice è cambiato dopo di esse.
if [[ ! -f "$ROOT_DIR/apps/api/dist/main.js" ]] || \
   [[ -n "$(find "$ROOT_DIR/apps/api/src" -newer "$ROOT_DIR/apps/api/dist/main.js" -print -quit 2>/dev/null)" ]]; then
  log "Compilo l'API (può richiedere un minuto)..."
  pnpm --filter @spokkio/api build >>"$LOG_FILE" 2>&1
fi

if [[ ! -d "$ROOT_DIR/apps/web/.next" ]] || \
   [[ -n "$(find "$ROOT_DIR/apps/web/src" -newer "$ROOT_DIR/apps/web/.next" -print -quit 2>/dev/null)" ]]; then
  log "Compilo l'interfaccia (può richiedere qualche minuto)..."
  pnpm --filter @spokkio/web build >>"$LOG_FILE" 2>&1
fi

# --- API --------------------------------------------------------------------
log "Avvio API su :3001"
cd "$ROOT_DIR/apps/api"
node dist/main.js >>"$LOG_FILE" 2>&1 &
API_PID=$!

for _ in $(seq 1 30); do
  curl -s -o /dev/null "http://localhost:3001/api/v1/auth/login" && break
  sleep 1
done

# --- Web --------------------------------------------------------------------
log "Avvio interfaccia su :3000"
cd "$ROOT_DIR/apps/web"
pnpm exec next start -p 3000 >>"$LOG_FILE" 2>&1 &
WEB_PID=$!

for _ in $(seq 1 30); do
  curl -s -o /dev/null "http://localhost:3000" && break
  sleep 1
done

log "Spokkio pronto: http://localhost:3000"
open "http://localhost:3000"

# Resta vivo finché uno dei due processi è in esecuzione (chiudendo l'app
# dal Dock/Monitoraggio Attività, il trap qui sopra li ferma entrambi).
wait
