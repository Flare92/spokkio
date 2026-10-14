#!/usr/bin/env bash
# Ferma Spokkio (database escluso). Lo richiama Spokkio.app quando la chiudi
# con Cmd+Q o "Esci" dal Dock; si può anche lanciare a mano dal Terminale.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/spokkio-common.sh
source "$ROOT_DIR/scripts/spokkio-common.sh"

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE" 2>/dev/null)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    log "Chiusura richiesta: arresto Spokkio (PID $pid)..."
    # Lo script di avvio intercetta il segnale e chiude API e interfaccia.
    kill -TERM "$pid" 2>/dev/null
    for _ in $(seq 1 30); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -0 "$pid" 2>/dev/null && kill_tree "$pid" KILL
  fi
  rm -f "$PID_FILE"
fi

# Rete di sicurezza per i processi rimasti da avvii chiusi male (es. app
# forzata a chiudersi): non tocca mai programmi che non sono di Spokkio.
free_spokkio_port 3001
free_spokkio_port 3000
exit 0
