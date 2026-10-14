# Percorsi e funzioni condivisi da spokkio-run.sh e spokkio-stop.sh.
# Da includere con `source` dopo aver impostato ROOT_DIR.
# Compatibile con la bash 3.2 di macOS (niente mapfile, wait -n, ecc.).

STATE_DIR="$HOME/Library/Application Support/Spokkio"
PID_FILE="$STATE_DIR/spokkio.pid"
LOG_DIR="$HOME/Library/Logs/Spokkio"
LOG_FILE="$LOG_DIR/spokkio.log"
mkdir -p "$STATE_DIR" "$LOG_DIR"

# I binari di Homebrew e di postgresql@16 (keg-only) non sono nel PATH di
# un'app avviata dal Finder, che non carica il profilo della shell.
export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/local/opt/postgresql@16/bin:$PATH"

log() { printf "[%s] %s\n" "$(date '+%H:%M:%S')" "$1" | tee -a "$LOG_FILE"; }

# "pnpm exec next start" avvia a sua volta un processo figlio: fermare solo il
# processo che abbiamo lanciato lascerebbe in vita il vero server, che
# continuerebbe a occupare la porta al prossimo avvio.
kill_tree() {
  local pid="$1" signal="${2:-TERM}"
  [[ -z "$pid" ]] && return 0
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child" "$signal"
  done
  kill "-$signal" "$pid" 2>/dev/null
}

is_spokkio_command() {
  local command_line="$1"
  [[ "$command_line" == *"$ROOT_DIR"* || "$command_line" == *"dist/main.js"* || \
     "$command_line" == *"next start"* || "$command_line" == *"next-server"* ]]
}

# Chiude i processi di Spokkio rimasti in ascolto su una porta (avvii
# precedenti chiusi male). Restituisce 1 se la porta è di un altro programma.
free_spokkio_port() {
  local port="$1" pid command_line foreign=0
  for pid in $(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null); do
    command_line="$(ps -p "$pid" -o command= 2>/dev/null)"
    if is_spokkio_command "$command_line"; then
      log "Chiudo una vecchia istanza di Spokkio sulla porta $port (PID $pid)."
      kill_tree "$pid" TERM
      local _
      for _ in $(seq 1 10); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
      done
      kill_tree "$pid" KILL
    else
      log "ERRORE: la porta $port è usata da un altro programma (PID $pid): $command_line"
      foreign=1
    fi
  done
  return "$foreign"
}
