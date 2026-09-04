#!/usr/bin/env bash
# Crea (o aggiorna) Spokkio.app in ~/Applications: un'app macOS vera,
# avviabile con doppio click dal Finder o dal Launchpad, che fa partire
# database, API e interfaccia e apre il browser — niente terminale.
#
#   ./scripts/build-mac-app.sh
#
# L'app è un guscio leggero: punta alla cartella del progetto dove si trova
# adesso, quindi se sposti il progetto va rilanciato questo script.

set -euo pipefail

say() { printf "\n\033[1;32m==>\033[0m %s\n" "$1"; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$HOME/Applications/Spokkio.app"

say "Compilo Spokkio per l'uso in locale (può richiedere qualche minuto)"
cd "$ROOT_DIR"
# Un aggiornamento del progetto può portare librerie nuove: senza questo
# passaggio la compilazione fallisce con "Module not found" su una dipendenza
# che è nel package.json ma non ancora installata in locale.
pnpm install
pnpm --filter @spokkio/shared build
pnpm --filter @spokkio/api exec prisma generate
pnpm --filter @spokkio/api build
pnpm --filter @spokkio/web build

say "Creo $APP_DIR"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"

cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Spokkio</string>
  <key>CFBundleDisplayName</key>
  <string>Spokkio</string>
  <key>CFBundleIdentifier</key>
  <string>com.spokkio.desktop</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>Spokkio</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>LSUIElement</key>
  <false/>
</dict>
</plist>
PLIST

cat > "$APP_DIR/Contents/MacOS/Spokkio" <<LAUNCHER
#!/usr/bin/env bash
# Guscio generato da scripts/build-mac-app.sh — punta al progetto Spokkio.
exec "$ROOT_DIR/scripts/spokkio-run.sh"
LAUNCHER

chmod +x "$APP_DIR/Contents/MacOS/Spokkio"
chmod +x "$ROOT_DIR/scripts/spokkio-run.sh"

say "Fatto."
cat <<EOF

✅ Spokkio.app creata in ~/Applications

Come si usa:
  • Apri il Finder -> Applicazioni (o cerca "Spokkio" con Spotlight, Cmd+Spazio)
  • Doppio click su Spokkio: parte tutto e si apre il browser su
    http://localhost:3000
  • Per chiuderlo: chiudi l'app dal Dock (tasto destro -> Esci)

I log stanno in ~/Library/Logs/Spokkio/spokkio.log

Nota: la prima volta macOS può chiedere conferma perché l'app non è firmata.
In quel caso: tasto destro sull'app -> Apri -> Apri.

Se sposti la cartella del progetto, rilancia questo script.
EOF
