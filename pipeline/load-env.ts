import { existsSync } from "node:fs";

/** Loads .env.local then .env (no dotenv dependency; Node ≥ 21.7). Real env vars win. */
export function loadLocalEnv(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
