#!/usr/bin/env bash
# Crea (o aggiorna) Spokkio.app in ~/Applications: un'app macOS vera,
# avviabile con doppio click dal Finder o dal Launchpad, che fa partire
# database, API e interfaccia e apre il browser — niente terminale.
#
#   ./scripts/build-mac-app.sh
#
# L'app è un applet AppleScript "stay open": a differenza di uno script di
# shell travestito da app, riceve davvero il comando "Esci" (Cmd+Q o Dock) e
# in quel momento ferma API e interfaccia. Punta alla cartella del progetto
# dove si trova adesso: se sposti il progetto, rilancia questo script.

set -euo pipefail

say() { printf "\n\033[1;32m==>\033[0m %s\n" "$1"; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$HOME/Applications/Spokkio.app"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say "Chiudo eventuali istanze di Spokkio ancora attive"
chmod +x "$ROOT_DIR"/scripts/*.sh
"$ROOT_DIR/scripts/spokkio-stop.sh" >/dev/null 2>&1 || true
# Le versioni precedenti dell'app non si chiudevano mai: fermiamo anche il
# loro script di avvio, se è rimasto appeso.
for pid in $(pgrep -f "$ROOT_DIR/scripts/spokkio-run.sh" 2>/dev/null || true); do
  if [[ "$pid" != "$$" ]]; then kill "$pid" 2>/dev/null || true; fi
done

say "Compilo Spokkio per l'uso in locale (può richiedere qualche minuto)"
cd "$ROOT_DIR"
# Un aggiornamento del progetto può portare librerie nuove: senza questo
# passaggio la compilazione fallisce con "Module not found". --frozen-lockfile
# evita di riscrivere pnpm-lock.yaml, che altrimenti bloccherebbe
# l'aggiornamento automatico (risulterebbe una "modifica locale").
pnpm install --frozen-lockfile || pnpm install
git checkout -- pnpm-lock.yaml 2>/dev/null || true
pnpm --filter @spokkio/shared build
pnpm --filter @spokkio/api exec prisma generate
pnpm --filter @spokkio/api build
pnpm --filter @spokkio/web build

say "Creo $APP_DIR"
# Il percorso finisce dentro una stringa AppleScript: virgolette e backslash
# vanno protetti.
escaped_root="${ROOT_DIR//\\/\\\\}"
escaped_root="${escaped_root//\"/\\\"}"

applescript_file="$(mktemp -t spokkio-app).applescript"
cat > "$applescript_file" <<APPLESCRIPT
-- Generato da scripts/build-mac-app.sh: non modificare a mano.
property rootDir : "$escaped_root"

on run
	startSpokkio()
end run

-- Click sull'icona con l'app già aperta: riapre solo il browser.
on reopen
	if spokkioIsRunning() then
		do shell script "open http://localhost:3000"
	else
		startSpokkio()
	end if
end reopen

-- Se Spokkio si ferma da solo (errore), chiude anche l'app invece di
-- lasciarla aperta a vuoto nel Dock.
on idle
	if not spokkioIsRunning() then quit
	return 5
end idle

-- Cmd+Q, "Esci" dal Dock, spegnimento del Mac.
on quit
	try
		do shell script quoted form of (rootDir & "/scripts/spokkio-stop.sh") & " > /dev/null 2>&1"
	end try
	continue quit
end quit

on startSpokkio()
	-- Ripulisce eventuali resti di un avvio precedente chiuso male.
	try
		do shell script quoted form of (rootDir & "/scripts/spokkio-stop.sh") & " > /dev/null 2>&1"
	end try
	-- Avvio staccato dall'app, che così resta libera di ricevere "Esci".
	do shell script "nohup " & quoted form of (rootDir & "/scripts/spokkio-run.sh") & " > /dev/null 2>&1 &"
	try
		display notification "Avvio in corso: il browser si aprirà da solo quando è pronto (dopo un aggiornamento può volerci qualche minuto)." with title "Spokkio"
	end try
	repeat 50 times
		if spokkioIsRunning() then exit repeat
		delay 0.2
	end repeat
end startSpokkio

on spokkioIsRunning()
	try
		do shell script "kill -0 \"\$(cat \"\$HOME/Library/Application Support/Spokkio/spokkio.pid\")\""
		return true
	on error
		return false
	end try
end spokkioIsRunning
APPLESCRIPT

rm -rf "$APP_DIR"
mkdir -p "$(dirname "$APP_DIR")"
osacompile -s -o "$APP_DIR" "$applescript_file"
rm -f "$applescript_file"

plist="$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName Spokkio" "$plist" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Add :CFBundleName string Spokkio" "$plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.spokkio.desktop" "$plist" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.spokkio.desktop" "$plist"

say "Fatto."
cat <<EOF

Spokkio.app creata in ~/Applications

Come si usa:
  • Apri il Finder -> Applicazioni (o cerca "Spokkio" con Spotlight, Cmd+Spazio)
  • Doppio click su Spokkio: parte tutto e il browser si apre da solo su
    http://localhost:3000
  • Per chiuderlo: pulsante "Chiudi Spokkio" in alto a destra nell'interfaccia,
    oppure tasto destro sull'icona di Spokkio nel Dock -> Esci. (Cmd+Q chiude
    il browser, che è l'app in primo piano.) Alla prossima apertura Spokkio
    controlla gli aggiornamenti e si ricompila da solo se serve.

I log stanno in ~/Library/Logs/Spokkio/spokkio.log

Se sposti la cartella del progetto, rilancia questo script.
EOF
