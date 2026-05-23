import { existsSync, readFileSync } from "fs";
import path from "path";

/** Load .env then .env.local into process.env (scripts only; does not override existing). */
export function loadEnvFile(): void {
  for (const name of [".env", ".env.local"]) {
    const filePath = path.join(process.cwd(), name);
    if (!existsSync(filePath)) continue;

    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}
