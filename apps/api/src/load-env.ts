import { existsSync } from "fs";
import { join } from "path";

// Carica apps/api/.env in process.env. Va importato per primo in main.ts:
// alcuni moduli leggono le variabili già al caricamento (es. JWT_SECRET,
// PUBLIC_BASE_URL). Le variabili già presenti nell'ambiente hanno la
// precedenza su quelle del file.
const envFile = join(__dirname, "..", ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
