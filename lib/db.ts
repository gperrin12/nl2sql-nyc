import { Pool } from "pg";

const globalForPg = globalThis as unknown as { pgPool?: Pool };

/** Serverless-safe singleton; skipped when DATABASE_URL is unset. */
export function getPgPool(): Pool | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;

  if (!globalForPg.pgPool) {
    globalForPg.pgPool = new Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalForPg.pgPool;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
