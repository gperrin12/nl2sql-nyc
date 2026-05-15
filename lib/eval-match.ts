/**
 * Match dashboard moments to judge results by question + SQL (not question alone).
 */

export function normalizeSqlForMatch(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/** Stable key for a question/SQL pair (client-safe, no Node crypto). */
export function evalMatchKey(question: string, sql: string): string {
  return `${question.trim()}\u0000${normalizeSqlForMatch(sql)}`;
}

/** True when eval was produced for the same SQL the dashboard row shows. */
export function evalMatchesMoment(
  evalResult: { question: string; sql: string },
  moment: { question: string; sql: string }
): boolean {
  return (
    evalResult.question.trim() === moment.question.trim() &&
    normalizeSqlForMatch(evalResult.sql) === normalizeSqlForMatch(moment.sql)
  );
}
