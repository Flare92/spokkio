#!/bin/bash
# Controlla passo per passo che il webhook WhatsApp sia raggiungibile da Meta
# e stampa URL di callback e token da incollare su Meta.
# Uso: ./scripts/spokkio-webhook-check.sh
# Compatibile con la bash 3.2 di macOS.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/apps/api/.env"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

OK="✅"; KO="❌"; WARN="⚠️ "
problems=0
fail() { echo "$KO $1"; [[ -n "$2" ]] && echo "   → $2"; problems=$((problems + 1)); }

# Legge l'ultimo valore di una variabile dal .env, togliendo virgolette dritte.
env_value() {
  grep -E "^[[:space:]]*$1[[:space:]]*=" "$ENV_FILE" | tail -1 | sed -E "s/^[^=]*=//; s/^[[:space:]]*//; s/[[:space:]]*$//; s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/"
}

echo "=== Controllo webhook Spokkio ==="
echo

# 1. File .env
if [[ ! -f "$ENV_FILE" ]]; then
  fail "Il file apps/api/.env non esiste." "Crealo con: cp apps/api/.env.example apps/api/.env"
  echo; echo "Correggi e rilancia lo script."; exit 1
fi
echo "$OK File .env trovato"

PUBLIC_URL="$(env_value PUBLIC_BASE_URL)"
TOKEN="$(env_value WHATSAPP_WEBHOOK_VERIFY_TOKEN)"
PUBLIC_URL="${PUBLIC_URL%/}"

count=$(grep -cE "^[[:space:]]*WHATSAPP_WEBHOOK_VERIFY_TOKEN[[:space:]]*=" "$ENV_FILE")
[[ "$count" -gt 1 ]] && echo "$WARN WHATSAPP_WEBHOOK_VERIFY_TOKEN compare $count volte: vale l'ultima. Meglio lasciarne una sola."

if [[ -z "$TOKEN" || "$TOKEN" == "change-me" ]]; then
  fail "Token di verifica non impostato (vuoto o ancora 'change-me')." "Nel .env scrivi: WHATSAPP_WEBHOOK_VERIFY_TOKEN=unaparolasegreta"
elif printf '%s' "$TOKEN" | LC_ALL=C grep -q '[^A-Za-z0-9._-]'; then
  fail "Il token contiene spazi, virgolette curve o simboli strani: '$TOKEN'" "Usa solo lettere, numeri, punto, trattino o underscore."
else
  echo "$OK Token di verifica impostato"
fi

if [[ ! "$PUBLIC_URL" =~ ^https://[^/]+$ ]]; then
  fail "PUBLIC_BASE_URL non valido: '$PUBLIC_URL'" "Deve essere tipo: PUBLIC_BASE_URL=https://tuo-dominio.ngrok-free.dev"
else
  echo "$OK PUBLIC_BASE_URL = $PUBLIC_URL"
fi
DOMAIN="${PUBLIC_URL#https://}"

# 2. Spokkio (API) in ascolto
PORT="$(env_value PORT)"; PORT="${PORT:-3001}"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "$OK Spokkio è acceso (porta $PORT)"
  local_answer="$(curl -s --max-time 5 "http://localhost:$PORT/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$TOKEN&hub.challenge=spokkio-ok")"
  if [[ "$local_answer" == "spokkio-ok" ]]; then
    echo "$OK Spokkio accetta il token del .env"
  else
    fail "Spokkio rifiuta il token del .env." "Probabilmente hai modificato il .env senza riavviare: premi 'Chiudi Spokkio', riaprilo e rilancia lo script."
  fi
else
  fail "Spokkio non è acceso sulla porta $PORT." "Apri l'app Spokkio, aspetta che si carichi e rilancia lo script."
fi

# 3. ngrok
if ! command -v ngrok >/dev/null 2>&1; then
  fail "ngrok non è installato." "Installa con: brew install ngrok"
else
  echo "$OK ngrok installato"
  if ! ngrok config check >/dev/null 2>&1 || ! grep -rqs "authtoken" "$HOME/Library/Application Support/ngrok" "$HOME/.config/ngrok" "$HOME/.ngrok2" 2>/dev/null; then
    fail "ngrok non ha l'authtoken." "Esegui: ngrok config add-authtoken IL-TUO-TOKEN (lo trovi su dashboard.ngrok.com)"
  else
    echo "$OK Authtoken ngrok configurato"
  fi

  tunnels="$(curl -s --max-time 3 http://127.0.0.1:4040/api/tunnels)"
  if [[ -z "$tunnels" ]]; then
    if [[ -n "$DOMAIN" && "$DOMAIN" != "$PUBLIC_URL" ]]; then
      echo "$WARN ngrok è spento: lo avvio io in background su $DOMAIN..."
      nohup ngrok http --url="$DOMAIN" "$PORT" >/tmp/spokkio-ngrok.log 2>&1 &
      sleep 4
      tunnels="$(curl -s --max-time 3 http://127.0.0.1:4040/api/tunnels)"
    fi
  fi
  if [[ -z "$tunnels" ]]; then
    fail "ngrok non è acceso." "Avvialo con: ngrok http --url=$DOMAIN $PORT  (log: /tmp/spokkio-ngrok.log)"
  elif ! echo "$tunnels" | grep -q "$DOMAIN"; then
    fail "ngrok è acceso ma su un altro indirizzo, non su $DOMAIN." "Chiudilo (Ctrl+C) e riavvialo con: ngrok http --url=$DOMAIN $PORT"
  elif ! echo "$tunnels" | grep -q "localhost:$PORT\|:$PORT\""; then
    fail "ngrok punta a una porta diversa da $PORT." "Riavvialo con: ngrok http --url=$DOMAIN $PORT"
  else
    echo "$OK ngrok acceso su $DOMAIN → porta $PORT"
  fi
fi

# 4. Test reale da internet (come fa Meta)
if [[ -n "$DOMAIN" && "$DOMAIN" != "$PUBLIC_URL" ]]; then
  answer="$(curl -s --max-time 10 -H "ngrok-skip-browser-warning: 1" "$PUBLIC_URL/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$TOKEN&hub.challenge=spokkio-ok")"
  if [[ "$answer" == "spokkio-ok" ]]; then
    echo "$OK Test da internet riuscito: Meta potrà verificare il webhook"
  else
    fail "Il test da internet non è riuscito." "Risposta ricevuta: $(echo "$answer" | head -c 200)"
  fi
fi

echo
if [[ "$problems" -eq 0 ]]; then
  echo "🎉 Tutto pronto. Su Meta → WhatsApp → Configurazione → Webhook incolla:"
  echo
  echo "   URL di callback:    $PUBLIC_URL/api/v1/webhooks/whatsapp"
  echo "   Token di verifica:  $TOKEN"
  echo
  echo "Poi 'Verifica e salva' e in 'Gestisci' attiva: messages, message_template_status_update"
  echo "Tieni aperti Spokkio e ngrok per ricevere letture e risposte."
else
  echo "Trovati $problems problemi: correggi quelli con $KO e rilancia lo script."
fi
