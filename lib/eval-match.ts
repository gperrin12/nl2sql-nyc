/**
 * Match dashboard moments to judge results.
 */

import type { FullJudgeResult } from "@/lib/judge";

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

export type EvalIndex = {
  byExactKey: Map<string, FullJudgeResult>;
  byQuestion: Map<string, FullJudgeResult[]>;
};

/** Index evals for dashboard lookup (newest first per question). */
export function buildEvalIndex(evals: FullJudgeResult[]): EvalIndex {
  const byExactKey = new Map<string, FullJudgeResult>();
  const byQuestion = new Map<string, FullJudgeResult[]>();

  const sorted = [...evals].sort(
    (a, b) =>
      new Date(b.judgedAt).getTime() - new Date(a.judgedAt).getTime()
  );

  for (const e of sorted) {
    byExactKey.set(evalMatchKey(e.question, e.sql), e);
    const q = e.question.trim();
    const list = byQuestion.get(q) ?? [];
    list.push(e);
    byQuestion.set(q, list);
  }

  return { byExactKey, byQuestion };
}

/**
 * Find the best eval for a dashboard moment.
 * 1. Exact question+SQL
 * 2. Newest same-question entry
 */
export function findEvalForMoment(
  moment: { question: string; sql: string },
  index: EvalIndex
): FullJudgeResult | undefined {
  const exactKey = evalMatchKey(moment.question, moment.sql);
  const exact = index.byExactKey.get(exactKey);
  if (exact) return exact;
  const q = moment.question.trim();
  const byQ = index.byQuestion.get(q) ?? [];
  return byQ[0];
}

/** Evals tied to dashboard rows (exact question+SQL match only). */
export function evalsForMoments(
  moments: { id: string; question: string; sql: string }[],
  evalByMomentId: Map<string, FullJudgeResult>
): FullJudgeResult[] {
  const seen = new Set<string>();
  const out: FullJudgeResult[] = [];
  for (const m of moments) {
    const e = evalByMomentId.get(m.id);
    if (!e || !evalMatchesMoment(e, m)) continue;
    const key = evalMatchKey(m.question, m.sql);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** Build moment id → eval for dashboard rows. */
export function buildEvalByMomentId(
  moments: { id: string; question: string; sql: string }[],
  evals: FullJudgeResult[],
  options?: { exactMatchOnly?: boolean }
): Map<string, FullJudgeResult> {
  const index = buildEvalIndex(evals);
  const map = new Map<string, FullJudgeResult>();
  for (const m of moments) {
    const e = options?.exactMatchOnly
      ? index.byExactKey.get(evalMatchKey(m.question, m.sql))
      : findEvalForMoment(m, index);
    if (e) map.set(m.id, e);
  }
  return map;
}
