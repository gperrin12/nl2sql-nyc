import { cookies } from "next/headers";

/**
 * Returns true if the request has a valid auth cookie.
 *
 * For v1 we use a single shared password compared to APP_PASSWORD. The
 * client POSTs the password to /api/login which sets an HttpOnly cookie.
 * Subsequent API calls just check for the cookie.
 */
export async function isAuthenticated(): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    // No password configured → app is open. Useful for local dev.
    return true;
  }
  const cookieStore = await cookies();
  const provided = cookieStore.get("auth")?.value;
  return provided === expected;
}
