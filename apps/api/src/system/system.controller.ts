import { Controller, Post, UseGuards } from "@nestjs/common";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

// Lo scrive scripts/spokkio-run.sh, il processo che tiene in vita API e interfaccia.
function pidFilePath() {
  return join(homedir(), "Library", "Application Support", "Spokkio", "spokkio.pid");
}

@UseGuards(JwtAuthGuard)
@Controller("system")
export class SystemController {
  // Chiude Spokkio dal browser: Cmd+Q chiude l'app in primo piano, che mentre
  // si usa Spokkio è il browser, non Spokkio. Fermando lo script di avvio si
  // fermano API e interfaccia, e l'app nel Dock se ne accorge e si chiude.
  @Post("shutdown")
  shutdown(): { stopping: boolean; reason?: string } {
    const file = pidFilePath();
    if (!existsSync(file)) {
      return { stopping: false, reason: "Spokkio non è stato avviato dall'app: chiudilo dal Terminale." };
    }
    const pid = Number(readFileSync(file, "utf8").trim());
    let command = "";
    try {
      command = execFileSync("ps", ["-p", String(pid), "-o", "command="]).toString();
    } catch {
      return { stopping: false, reason: "Spokkio risulta già chiuso." };
    }
    // Un PID file vecchio potrebbe puntare a un altro programma che ha
    // riusato lo stesso numero: si ferma solo se è davvero lo script di Spokkio.
    if (!command.includes("spokkio-run.sh")) {
      return { stopping: false, reason: "Spokkio risulta già chiuso." };
    }
    // Rispondiamo prima di fermarci, altrimenti il browser non saprebbe l'esito.
    setTimeout(() => process.kill(pid, "SIGTERM"), 300);
    return { stopping: true };
  }
}
