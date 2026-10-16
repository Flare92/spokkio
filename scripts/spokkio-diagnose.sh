#!/bin/bash
# Raccoglie in un unico rapporto tutto ciò che serve per capire perché
# letture/risposte non si aggiornano o perché l'icona non cambia.
# Uso: ./scripts/spokkio-diagnose.sh   (il rapporto finisce anche sulla Scrivania)
# Non stampa token né password. Compatibile con la bash 3.2 di macOS.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/local/opt/postgresql@16/bin:$PATH"
REPORT="$HOME/Desktop/spokkio-diagnosi.txt"
LOG_FILE="$HOME/Library/Logs/Spokkio/spokkio.log"
PID_FILE="$HOME/Library/Application Support/Spokkio/spokkio.pid"

section() { printf "\n=== %s ===\n" "$1"; }

{
echo "Diagnosi Spokkio — $(date '+%d/%m/%Y %H:%M:%S')"

section "1. Versione del codice"
cd "$ROOT_DIR" || exit 1
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
git fetch -q origin "$branch" 2>/dev/null
echo "Ramo: $branch"
echo "Locale:  $(git log -1 --format='%h %cd %s' --date=format:'%d/%m %H:%M' 2>/dev/null)"
echo "Online:  $(git log -1 --format='%h %cd %s' --date=format:'%d/%m %H:%M' "origin/$branch" 2>/dev/null)"
behind="$(git rev-list --count "HEAD..origin/$branch" 2>/dev/null)"
[[ "$behind" != "0" ]] && echo "!! Il codice locale è indietro di $behind aggiornamenti: serve git pull"
dirty="$(git status --porcelain 2>/dev/null | grep -v '^??' | head -5)"
[[ -n "$dirty" ]] && echo "!! File modificati in locale (possono bloccare git pull):" && echo "$dirty"
if grep -rqs "Ricevuto da Meta" "$ROOT_DIR/apps/api/dist"; then
  echo "API compilata: aggiornata"
else
  echo "!! API compilata: vecchia (chiudi e riapri Spokkio per ricompilarla)"
fi

section "2. Spokkio in esecuzione"
pid="$(cat "$PID_FILE" 2>/dev/null)"
if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then echo "Avviato (PID $pid)"; else echo "!! Spokkio non risulta avviato"; fi
for port in 3000 3001; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "Porta $port: in ascolto"; else echo "!! Porta $port: nessuno in ascolto"; fi
done
pgrep -x caffeinate >/dev/null && echo "Blocco stop del Mac: attivo" || echo "Blocco stop del Mac: non attivo"
pmset -g log 2>/dev/null | grep -E " Sleep  " | tail -3 | sed 's/^/Ultimo stop del Mac: /'

section "3. ngrok e chiamate di Meta"
tunnels="$(curl -s --max-time 3 http://127.0.0.1:4040/api/tunnels)"
if [[ -z "$tunnels" ]]; then
  echo "!! ngrok non è acceso"
else
  echo "$tunnels" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      for (const t of JSON.parse(s).tunnels||[]) console.log("Tunnel: "+t.public_url+" -> "+(t.config&&t.config.addr));
    });'
  curl -s --max-time 3 "http://127.0.0.1:4040/api/requests/http?limit=100" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const reqs=(JSON.parse(s).requests||[]).filter(r=>r.request&&r.request.uri&&r.request.uri.includes("webhooks/whatsapp"));
      const posts=reqs.filter(r=>r.request.method==="POST");
      console.log("Chiamate webhook viste da questo ngrok: "+reqs.length+" (di cui POST da Meta: "+posts.length+")");
      for (const r of posts.slice(0,8)) console.log("  POST "+new Date(r.start).toLocaleString("it-IT")+" -> "+(r.response?r.response.status:"nessuna risposta"));
      if(posts.length===0) console.log("!! Nessuna POST: Meta non sta mandando eventi a questo indirizzo da quando ngrok è partito");
    });'
fi

section "4. Log di Spokkio (webhook)"
if [[ -f "$LOG_FILE" ]]; then
  grep -E "Ricevuto da Meta|messaggio sconosciuto|Inbound message from unknown|Failed to process webhook|ngrok" "$LOG_FILE" | tail -15
  [[ -z "$(grep -E 'Ricevuto da Meta' "$LOG_FILE" | tail -1)" ]] && echo "(nessuna chiamata di Meta registrata nel log)"
else
  echo "!! Log non trovato in $LOG_FILE"
fi

section "5. Database: messaggi degli ultimi 3 giorni"
db_url="$(grep -E '^[[:space:]]*DATABASE_URL[[:space:]]*=' "$ROOT_DIR/apps/api/.env" 2>/dev/null | tail -1 | sed -E 's/^[^=]*=//; s/^[[:space:]"]*//; s/[[:space:]"]*$//; s/\?.*$//')"
if [[ -z "$db_url" ]] || ! command -v psql >/dev/null 2>&1; then
  echo "!! Impossibile leggere il database (manca DATABASE_URL o psql)"
else
  psql "$db_url" -X -q -P pager=off -c "
    select direction as verso, status as stato, count(*) as quanti,
           count(*) filter (where \"waMessageId\" is null) as senza_id_meta,
           to_char(max(\"createdAt\"), 'DD/MM HH24:MI') as ultimo
    from messages where \"createdAt\" > now() - interval '3 days'
    group by 1,2 order by 1,2;" 2>&1
  psql "$db_url" -X -q -P pager=off -c "
    select kind as evento, count(*) as quanti, to_char(max(\"occurredAt\"), 'DD/MM HH24:MI') as ultimo
    from attribution_events where \"occurredAt\" > now() - interval '3 days' group by 1 order by 1;" 2>&1
fi

section "6. Icona dell'app"
apps="$( (mdfind "kMDItemCFBundleIdentifier == 'com.spokkio.desktop'" 2>/dev/null; mdfind "kMDItemFSName == 'Spokkio.app'" 2>/dev/null; ls -d /Applications/Spokkio*.app "$HOME/Applications/Spokkio"*.app "$HOME/Desktop/Spokkio"*.app 2>/dev/null) | sort -u)"
if [[ -z "$apps" ]]; then
  echo "!! Nessuna Spokkio.app trovata"
else
  echo "$apps" | while IFS= read -r app; do
    [[ -d "$app" ]] || continue
    plist="$app/Contents/Info.plist"
    echo "App: $app"
    echo "  modificata: $(stat -f '%Sm' -t '%d/%m %H:%M' "$app" 2>/dev/null)"
    echo "  CFBundleIconFile: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$plist" 2>/dev/null || echo '-')"
    echo "  CFBundleIconName: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconName' "$plist" 2>/dev/null || echo '- (ok, assente)')"
    [[ -f "$app/Contents/Resources/Assets.car" ]] && echo "  !! Assets.car presente (copre l'icona di Spokkio)" || echo "  Assets.car: assente (ok)"
    echo "  applet.icns: $(stat -f '%z byte, %Sm' -t '%d/%m %H:%M' "$app/Contents/Resources/applet.icns" 2>/dev/null || echo 'mancante')"
  done
fi
echo "Spokkio nel Dock:"
defaults read com.apple.dock persistent-apps 2>/dev/null | grep -i "spokkio" | grep -i "_CFURLString\"" | sed 's/^ */  /' || true
defaults read com.apple.dock persistent-apps 2>/dev/null | grep -qi spokkio || echo "  (non fissato nel Dock)"
} 2>&1 | tee "$REPORT"

echo
echo "Rapporto salvato in: $REPORT"
