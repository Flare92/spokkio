#!/usr/bin/env bash
# Ripristina il database Spokkio da uno dei backup automatici giornalieri
# creati da scripts/spokkio-run.sh (in ~/Library/Application Support/Spokkio/backups).
#
# ATTENZIONE: sovrascrive il database corrente. Chiudi Spokkio prima di usarlo.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$HOME/Library/Application Support/Spokkio/backups"
export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/local/opt/postgresql@16/bin:$PATH"

mapfile -t BACKUPS < <(ls -1t "$BACKUP_DIR"/spokkio-*.sql.gz 2>/dev/null)
if [[ ${#BACKUPS[@]} -eq 0 ]]; then
  echo "Nessun backup trovato in $BACKUP_DIR"
  exit 1
fi

echo "Backup disponibili (dal più recente):"
for i in "${!BACKUPS[@]}"; do
  printf "  %d) %s\n" "$((i + 1))" "$(basename "${BACKUPS[$i]}")"
done

read -rp "Quale vuoi ripristinare? [1]: " CHOICE
CHOICE="${CHOICE:-1}"
SELECTED="${BACKUPS[$((CHOICE - 1))]}"
if [[ -z "$SELECTED" ]]; then
  echo "Scelta non valida."
  exit 1
fi

DB_URL="$(grep '^DATABASE_URL=' "$ROOT_DIR/apps/api/.env" 2>/dev/null | cut -d '=' -f2- | tr -d '"')"
DB_URL="${DB_URL%%\?*}"
if [[ -z "$DB_URL" ]]; then
  echo "Non trovo DATABASE_URL in apps/api/.env"
  exit 1
fi

echo "Questo SOSTITUISCE tutti i dati attuali con il contenuto di $(basename "$SELECTED")."
read -rp "Confermi? Scrivi 'sì' per procedere: " CONFIRM
if [[ "$CONFIRM" != "sì" && "$CONFIRM" != "si" ]]; then
  echo "Operazione annullata."
  exit 0
fi

echo "Ripristino in corso..."
gunzip -c "$SELECTED" | psql "$DB_URL"
echo "Fatto. Riavvia Spokkio."
