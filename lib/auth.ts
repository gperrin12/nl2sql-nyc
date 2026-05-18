import { cookies } from "next/headers";

/**
 * Auth is disabled — the app is open without a login gate.
 * API routes still call this helper so password protection can be re-enabled later
 * by restoring cookie checks against APP_PASSWORD.
 */
export async function isAuthenticated(): Promise<boolean> {
  return true;
}

/** @internal Reserved for optional password protection */
export async function isAuthenticatedWithPassword(): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return true;
  const cookieStore = await cookies();
  const provided = cookieStore.get("auth")?.value;
  return provided === expected;
}
