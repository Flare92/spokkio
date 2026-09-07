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

# "pnpm exec next start" avvia a sua volta un processo figlio: fermare solo il
# processo che abbiamo lanciato lascerebbe in vita il vero server, che
# continuerebbe a occupare la porta al prossimo avvio.
kill_tree() {
  local pid="$1"
  [[ -z "$pid" ]] && return 0
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null
}

cleanup() {
  log "Arresto Spokkio..."
  kill_tree "${API_PID:-}"
  kill_tree "${WEB_PID:-}"
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
log "Allineo dipendenze, pacchetto condiviso e schema del database..."
# Se un aggiornamento ha introdotto librerie nuove vanno installate prima di
# compilare, altrimenti la build fallisce su un modulo mancante.
pnpm install >>"$LOG_FILE" 2>&1
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

# --- Porte già occupate ------------------------------------------------------
# Un avvio precedente può lasciare i suoi processi in vita: chiudere il
# terminale non li uccide, e se l'app viene forzata a chiudersi il codice di
# pulizia non fa in tempo a girare. Se ciò che occupa la porta è una vecchia
# istanza di Spokkio la recuperiamo da soli (è l'unico comportamento sensato
# per un'app che si riapre con un doppio click); se invece è un programma di
# qualcun altro ci fermiamo e lo diciamo, senza spegnere roba non nostra.
free_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti "tcp:$port" 2>/dev/null)"
  [[ -z "$pids" ]] && return 0

  for pid in $pids; do
    local command_line
    command_line="$(ps -p "$pid" -o command= 2>/dev/null)"

    if [[ "$command_line" == *"$ROOT_DIR"* || "$command_line" == *"dist/main.js"* || "$command_line" == *"next start"* || "$command_line" == *"next-server"* ]]; then
      log "Trovata una vecchia istanza di Spokkio sulla porta $port (PID $pid): la chiudo."
      kill "$pid" 2>/dev/null
      for _ in $(seq 1 10); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
      done
      kill -9 "$pid" 2>/dev/null
    else
      log "ERRORE: la porta $port è usata da un altro programma (PID $pid): $command_line"
      osascript -e "display alert \"Spokkio\" message \"La porta $port è occupata da un altro programma (PID $pid). Chiudilo e riapri Spokkio.\"" 2>/dev/null
      exit 1
    fi
  done

  # Il rilascio della porta non è immediato dopo la chiusura del processo.
  for _ in $(seq 1 10); do
    [[ -z "$(lsof -ti "tcp:$port" 2>/dev/null)" ]] && return 0
    sleep 0.5
  done
}

free_port 3001
free_port 3000

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
