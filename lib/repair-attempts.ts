import { readFileSync } from "fs";
import path from "path";
import type { Pool } from "pg";

const MIGRATION_PATH = path.join(
  process.cwd(),
  "scripts/sql/add-repair-attempts.sql"
);

export async function ensureRepairAttemptsTable(pool: Pool): Promise<void> {
  const probe = await pool.query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'nl2sql' AND table_name = 'repair_attempts'
    LIMIT 1
  `);
  if (probe.rowCount && probe.rowCount > 0) return;

  const sql = readFileSync(MIGRATION_PATH, "utf8");
  await pool.query(sql);
}
