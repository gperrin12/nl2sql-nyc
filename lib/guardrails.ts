/**
 * Light-touch SQL guardrails. The Athena workgroup should ALSO have a
 * BytesScannedCutoffPerQuery set as a hard backstop — these checks are
 * the first line of defense, not the only one.
 */

const FORBIDDEN_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
  "TRUNCATE", "GRANT", "REVOKE", "MERGE", "REPLACE",
];

export type GuardrailResult =
  | { ok: true; sql: string }
  | { ok: false; reason: string };

export function checkSql(rawSql: string): GuardrailResult {
  const sql = rawSql.trim();
  if (!sql) return { ok: false, reason: "Empty SQL" };

  // Single statement only — trailing semicolon is fine, but no second statement.
  const stripped = sql.replace(/;\s*$/, "");
  if (stripped.includes(";")) {
    return { ok: false, reason: "Multiple SQL statements not allowed" };
  }

  const upper = stripped.toUpperCase();

  // Must start with SELECT or WITH.
  if (!/^\s*(SELECT|WITH)\b/.test(upper)) {
    return { ok: false, reason: "Only SELECT / WITH queries are allowed" };
  }

  // Token-boundary checks for dangerous keywords. We use \b to avoid matching
  // substrings inside column names like 'created_date' (matching CREATE).
  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(stripped)) {
      return { ok: false, reason: `Forbidden keyword: ${kw}` };
    }
  }

  return { ok: true, sql: stripped };
}
