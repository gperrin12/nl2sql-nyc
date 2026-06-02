/**
 * Stable keys for question/SQL pairs (eval scripts).
 */

export function normalizeSqlForMatch(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/** Stable key for a question/SQL pair (client-safe, no Node crypto). */
export function evalMatchKey(question: string, sql: string): string {
  return `${question.trim()}\u0000${normalizeSqlForMatch(sql)}`;
}
