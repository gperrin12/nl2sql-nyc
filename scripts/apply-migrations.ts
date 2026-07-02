/**
 * Apply the SQL files in migrations/ (in filename order) against NEON_DATABASE_URL.
 *
 * Every migration is written to be idempotent (IF NOT EXISTS / ALTER ... SET
 * DEFAULT), so this is safe to re-run — it just brings a DB up to date.
 *
 * Usage (reads .env / .env.local):
 *   npm run migrate
 *   tsx scripts/apply-migrations.ts
 */

import { readFileSync, readdirSync } from "fs";
import path from "path";
import { loadEnvFile } from "../lib/load-env-file";

loadEnvFile();

import { getPgPool, isDatabaseConfigured } from "../lib/db";

async function main() {
  if (!isDatabaseConfigured()) {
    console.error("Error: NEON_DATABASE_URL is required to apply migrations");
    process.exit(1);
  }

  const pool = getPgPool();
  if (!pool) {
    console.error("Error: could not create a database pool");
    process.exit(1);
  }

  const dir = path.join(process.cwd(), "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No .sql files found in migrations/");
    return;
  }

  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    process.stdout.write(`Applying ${file} … `);
    try {
      await pool.query(sql);
      console.log("ok");
    } catch (e) {
      console.log("FAILED");
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  }

  await pool.end();
  console.log(`\nDone — applied ${files.length} migration(s).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
