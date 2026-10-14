#!/usr/bin/env bash
# Avvia Spokkio in locale (Postgres + API + Web) e apre il browser.
# Lo lancia Spokkio.app: non serve usarlo a mano. Per fermarlo c'è
# scripts/spokkio-stop.sh, che l'app richiama quando la chiudi.
#
# Tutto il corpo è dentro main(): bash legge un file un pezzo alla volta
# mentre lo esegue, e l'aggiornamento automatico sovrascrive proprio questo
# file. Con una funzione bash ha già letto tutto prima di partire.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/spokkio-common.sh
source "$ROOT_DIR/scripts/spokkio-common.sh"

API_PID=""
WEB_PID=""
CLEANED_UP=0

cleanup() {
  [[ "$CLEANED_UP" == 1 ]] && return
  CLEANED_UP=1
  log "Arresto Spokkio..."
  kill_tree "$API_PID" TERM
  kill_tree "$WEB_PID" TERM
  sleep 1
  kill_tree "$API_PID" KILL
  kill_tree "$WEB_PID" KILL
  # Il PID file appartiene a questo processo solo se contiene ancora il suo PID.
  [[ "$(cat "$PID_FILE" 2>/dev/null)" == "$$" ]] && rm -f "$PID_FILE"
  log "Spokkio arrestato."
}

alert() {
  osascript -e "display alert \"Spokkio\" message \"$1\"" >/dev/null 2>&1
}

stop_previous_instance() {
  local previous
  previous="$(cat "$PID_FILE" 2>/dev/null)"
  if [[ -n "$previous" && "$previous" != "$$" ]] && kill -0 "$previous" 2>/dev/null; then
    log "Trovata un'istanza precedente ancora attiva (PID $previous): la chiudo prima di ripartire."
    "$ROOT_DIR/scripts/spokkio-stop.sh" >/dev/null 2>&1
  fi
  echo "$$" > "$PID_FILE"
}

# Si allinea da solo al branch remoto, ma solo con un fast-forward pulito. Se
# l'aggiornamento riesce riparte dall'inizio con la versione nuova di questo
# script (exec mantiene lo stesso PID, quindi il PID file resta valido).
auto_update() {
  [[ -n "${SPOKKIO_JUST_UPDATED:-}" ]] && return
  git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return

  local branch local_rev remote_rev dirty
  branch="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if [[ -z "$branch" || "$branch" == "HEAD" ]] || ! git -C "$ROOT_DIR" fetch origin "$branch" --quiet 2>>"$LOG_FILE"; then
    log "Controllo aggiornamenti non riuscito (probabilmente offline): continuo con la versione attuale."
    return
  fi

  local_rev="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null)"
  remote_rev="$(git -C "$ROOT_DIR" rev-parse "origin/$branch" 2>/dev/null)"
  [[ -z "$remote_rev" || "$local_rev" == "$remote_rev" ]] && return

  # pnpm-lock.yaml può essere riscritto da "pnpm install" con una versione di
  # pnpm diversa: non è una modifica dell'utente e non deve bloccare per
  # sempre gli aggiornamenti, quindi lo riportiamo alla versione del repository.
  if git -C "$ROOT_DIR" status --porcelain -- pnpm-lock.yaml | grep -q .; then
    git -C "$ROOT_DIR" checkout -- pnpm-lock.yaml 2>>"$LOG_FILE"
  fi
  dirty="$(git -C "$ROOT_DIR" status --porcelain 2>/dev/null)"
  if [[ -n "$dirty" ]]; then
    log "Aggiornamento disponibile ma ci sono modifiche locali non salvate, lo salto. File modificati:"
    printf "%s\n" "$dirty" >>"$LOG_FILE"
    return
  fi

  log "Aggiornamento disponibile: scarico l'ultima versione di Spokkio..."
  if git -C "$ROOT_DIR" merge --ff-only "origin/$branch" >>"$LOG_FILE" 2>&1; then
    log "Spokkio aggiornato a $(git -C "$ROOT_DIR" rev-parse --short HEAD), riparto con la nuova versione."
    export SPOKKIO_JUST_UPDATED=1
    exec "$ROOT_DIR/scripts/spokkio-run.sh"
  fi
  log "Aggiornamento saltato: impossibile avanzare in fast-forward (storia divergente)."
}

start_postgres() {
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
    alert "PostgreSQL non si è avviato. Controlla il log in ~/Library/Logs/Spokkio/spokkio.log"
    return 1
  fi
}

# Un dump al giorno, prima di qualunque modifica allo schema (il passo dopo
# esegue "prisma db push", che può arrivare da un aggiornamento appena
# scaricato). Tiene gli ultimi 14.
backup_database() {
  local backup_dir="$STATE_DIR/backups" today db_url
  mkdir -p "$backup_dir"
  today="$backup_dir/spokkio-$(date +%Y%m%d).sql.gz"
  [[ -f "$today" ]] && return

  db_url="$(grep '^DATABASE_URL=' "$ROOT_DIR/apps/api/.env" 2>/dev/null | cut -d '=' -f2- | tr -d '"')"
  db_url="${db_url%%\?*}" # pg_dump non conosce il parametro "schema" che Prisma aggiunge
  if [[ -n "$db_url" ]] && pg_dump "$db_url" 2>>"$LOG_FILE" | gzip > "$today.tmp"; then
    mv "$today.tmp" "$today"
    log "Backup del database salvato in $today"
    ls -1t "$backup_dir"/spokkio-*.sql.gz 2>/dev/null | tail -n +15 | xargs rm -f
  else
    rm -f "$today.tmp"
    log "ATTENZIONE: backup del database non riuscito (continuo comunque l'avvio)."
  fi
}

# Le build pesanti girano solo se mancano o se il codice (incluso il pacchetto
# condiviso) è cambiato dopo l'ultima compilazione.
needs_build() {
  local marker="$1" src="$2"
  [[ ! -e "$marker" ]] && return 0
  [[ -n "$(find "$src" "$ROOT_DIR/packages/shared/src" -newer "$marker" -print -quit 2>/dev/null)" ]]
}

build() {
  cd "$ROOT_DIR" || return 1
  log "Allineo dipendenze, pacchetto condiviso e schema del database..."
  # --frozen-lockfile non riscrive pnpm-lock.yaml; se fallisce (lockfile non
  # allineato) si ripiega su un install normale.
  pnpm install --frozen-lockfile >>"$LOG_FILE" 2>&1 || pnpm install >>"$LOG_FILE" 2>&1
  pnpm --filter @spokkio/shared build >>"$LOG_FILE" 2>&1
  pnpm --filter @spokkio/api exec prisma generate >>"$LOG_FILE" 2>&1
  # "db push" invece delle migrazioni: aggiunge le colonne nuove preservando
  # i dati già presenti in locale.
  pnpm --filter @spokkio/api exec prisma db push --skip-generate >>"$LOG_FILE" 2>&1

  if needs_build "$ROOT_DIR/apps/api/dist/main.js" "$ROOT_DIR/apps/api/src"; then
    log "Compilo l'API (può richiedere un minuto)..."
    pnpm --filter @spokkio/api build >>"$LOG_FILE" 2>&1 || { alert "Compilazione dell'API fallita. Dettagli in ~/Library/Logs/Spokkio/spokkio.log"; return 1; }
  fi
  if needs_build "$ROOT_DIR/apps/web/.next/BUILD_ID" "$ROOT_DIR/apps/web/src"; then
    log "Compilo l'interfaccia (può richiedere qualche minuto)..."
    pnpm --filter @spokkio/web build >>"$LOG_FILE" 2>&1 || { alert "Compilazione dell'interfaccia fallita. Dettagli in ~/Library/Logs/Spokkio/spokkio.log"; return 1; }
  fi
}

wait_for() {
  local url="$1"
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "$url" && return 0
    sleep 1
  done
  return 1
}

main() {
  trap cleanup EXIT
  trap 'cleanup; exit 0' INT TERM HUP

  stop_previous_instance
  log "Avvio Spokkio da $ROOT_DIR"
  auto_update
  start_postgres || exit 1
  backup_database
  build || exit 1

  if ! free_spokkio_port 3001 || ! free_spokkio_port 3000; then
    alert "Le porte 3000 o 3001 sono occupate da un altro programma. Chiudilo e riapri Spokkio (dettagli nel log)."
    exit 1
  fi

  log "Avvio API su :3001"
  cd "$ROOT_DIR/apps/api" || exit 1
  node dist/main.js >>"$LOG_FILE" 2>&1 &
  API_PID=$!
  wait_for "http://localhost:3001/api/v1/auth/login"

  log "Avvio interfaccia su :3000"
  cd "$ROOT_DIR/apps/web" || exit 1
  pnpm exec next start -p 3000 >>"$LOG_FILE" 2>&1 &
  WEB_PID=$!
  wait_for "http://localhost:3000"

  log "Spokkio pronto: http://localhost:3000"
  open "http://localhost:3000"

  # Resta attivo finché API e interfaccia girano entrambe. Se una delle due si
  # ferma da sola lo segnaliamo e chiudiamo tutto, invece di lasciare un'app
  # aperta a metà. (Niente "wait -n": la bash di macOS è la 3.2.)
  while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
    sleep 2
  done
  log "ERRORE: l'API o l'interfaccia si sono fermate inaspettatamente."
  alert "Spokkio si è fermato inaspettatamente. Dettagli in ~/Library/Logs/Spokkio/spokkio.log"
  exit 1
}

main "$@"; exit $?
