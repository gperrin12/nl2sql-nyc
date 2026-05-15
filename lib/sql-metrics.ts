/**
 * Client-safe helpers for question and SQL complexity metrics (dashboard).
 */

export type SqlComplexity = {
  cteCount: number;
  joinCount: number;
  tableCount: number;
  charLength: number;
  score: number;
};

export type QuestionMetrics = {
  charCount: number;
  wordCount: number;
};

export function questionMetrics(question: string): QuestionMetrics {
  const trimmed = question.trim();
  return {
    charCount: trimmed.length,
    wordCount: trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0,
  };
}

/** Rough SQL complexity proxy from the query text alone. */
export function sqlComplexity(sql: string): SqlComplexity {
  const normalized = sql.trim();
  const withoutLineComments = normalized.replace(/--[^\n]*/g, " ");
  const withoutBlockComments = withoutLineComments.replace(
    /\/\*[\s\S]*?\*\//g,
    " "
  );
  const body = withoutBlockComments;

  const cteCount = (body.match(/\bWITH\b/gi) ?? []).length;
  const joinCount = (body.match(/\bJOIN\b/gi) ?? []).length;

  const tableRefs = new Set<string>();
  const fromJoinRe =
    /\b(?:FROM|JOIN)\s+(?:\()?["`]?([a-zA-Z_][\w]*)["`]?(?:\.["`]?([a-zA-Z_][\w]*)["`]?)?/gi;
  let m: RegExpExecArray | null;
  while ((m = fromJoinRe.exec(body)) !== null) {
    const table = (m[2] ?? m[1]).toLowerCase();
    const skip = new Set([
      "select",
      "where",
      "on",
      "and",
      "or",
      "as",
      "lateral",
      "unnest",
    ]);
    if (!skip.has(table)) tableRefs.add(table);
  }

  const charLength = normalized.length;
  const tableCount = tableRefs.size;
  const score =
    cteCount * 3 + joinCount * 2 + tableCount + Math.floor(charLength / 250);

  return { cteCount, joinCount, tableCount, charLength, score };
}

export function formatLatencyMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
