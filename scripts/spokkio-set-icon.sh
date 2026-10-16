#!/bin/bash
# Applica l'icona di Spokkio a Spokkio.app come "icona personalizzata" (come
# trascinare un'immagine in Finder > Ottieni informazioni). Ha la precedenza
# sull'icona del pacchetto e sulla cache delle icone di macOS, che spesso
# continua a mostrare l'icona generica degli script anche dopo averla
# sostituita. Lo richiama build-mac-app.sh; si può lanciare anche da solo:
#   ./scripts/spokkio-set-icon.sh [percorso/immagine.png]

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$HOME/Applications/Spokkio.app"
ICON_PNG="${1:-$ROOT_DIR/assets/spokkio-icon.png}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "Spokkio.app non trovata in ~/Applications: lancia prima ./scripts/build-mac-app.sh"
  exit 1
fi
if [[ ! -f "$ICON_PNG" ]]; then
  echo "Immagine non trovata: $ICON_PNG"
  exit 1
fi

result="$(osascript -l JavaScript - "$ICON_PNG" "$APP_DIR" <<'JXA'
ObjC.import("AppKit");
function run(argv) {
  const image = $.NSImage.alloc.initWithContentsOfFile(argv[0]);
  if (image.isNil()) return "immagine non leggibile";
  const ok = $.NSWorkspace.sharedWorkspace.setIconForFileOptions(image, argv[1], 0);
  return ok ? "ok" : "macOS ha rifiutato l'icona";
}
JXA
)"

if [[ "$result" != "ok" ]]; then
  echo "Icona non applicata: $result"
  exit 1
fi

# Aggiorna Finder, Dock e Launchpad senza riavviare il Mac.
touch "$APP_DIR"
lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[[ -x "$lsregister" ]] && "$lsregister" -f "$APP_DIR" >/dev/null 2>&1
killall Dock >/dev/null 2>&1
killall Finder >/dev/null 2>&1
echo "Icona di Spokkio applicata."
