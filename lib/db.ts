import { Pool } from "pg";

const globalForPg = globalThis as unknown as { pgPool?: Pool };

function poolSslOption(
  connectionString: string
): boolean | { rejectUnauthorized: boolean } | undefined {
  if (/sslmode=disable/i.test(connectionString)) {
    return false;
  }
  if (process.env.DATABASE_SSL === "true") {
    return { rejectUnauthorized: false };
  }
  if (/sslmode=require/i.test(connectionString)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

/** Serverless-safe singleton; skipped when NEON_DATABASE_URL is unset. */
export function getPgPool(): Pool | null {
  const url = process.env.NEON_DATABASE_URL?.trim();
  if (!url) return null;

  if (/localhost|127\.0\.0\.1/i.test(url) && process.env.VERCEL === "1") {
    console.warn(
      "[db] NEON_DATABASE_URL points at localhost on Vercel — use your Neon pooled connection string"
    );
  }

  if (!globalForPg.pgPool) {
    const ssl = poolSslOption(url);
    globalForPg.pgPool = new Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ...(ssl !== undefined ? { ssl } : {}),
    });
  }
  return globalForPg.pgPool;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.NEON_DATABASE_URL?.trim());
}

/** Quick connectivity check for /api/query/log GET. */
export async function probeDatabase(): Promise<
  { ok: true } | { ok: false; detail: string }
> {
  if (!isDatabaseConfigured()) {
    return { ok: false, detail: "NEON_DATABASE_URL is not set" };
  }

  const pool = getPgPool();
  if (!pool) return { ok: false, detail: "Could not create pool" };

  try {
    await pool.query("SELECT 1");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
