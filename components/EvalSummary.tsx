"use client";

import type { ReactNode } from "react";
import type { FullJudgeResult } from "@/lib/judge";
import { blendJudgeOverall } from "@/lib/judge-blend";
import type { QueryCategory } from "@/lib/query-category";
import {
  DATASET_LABELS,
  detectDatasets,
  type QueryDataset,
} from "@/lib/query-dataset";
import {
  DIFFICULTY_LABELS,
  difficultyFromSql,
  type QueryDifficulty,
} from "@/lib/query-difficulty";

type BreakdownRow = {
  key: string;
  label: string;
  count: number;
  avgScore: number;
  correctPct: number;
  correct: number;
  partial: number;
  incorrect: number;
};

const CATEGORY_LABELS: Record<QueryCategory, string> = {
  spatial: "Spatial",
  demographic: "Demographic",
  "time-series": "Time series",
  ranking: "Ranking",
  comparison: "Comparison",
  aggregation: "Aggregation",
  lookup: "Lookup",
  other: "Other",
};

function evalDisplayScore(e: FullJudgeResult): number {
  if (typeof e.overall === "number" && Number.isFinite(e.overall)) {
    return e.overall;
  }
  const re = e.resultEval;
  if (re) {
    const sql =
      typeof e.sqlOverall === "number" && Number.isFinite(e.sqlOverall)
        ? e.sqlOverall
        : e.overall;
    return blendJudgeOverall(sql, re.resultQuality, re.vizFit);
  }
  return e.overall;
}

function buildBreakdown(
  evals: FullJudgeResult[],
  keyFn: (e: FullJudgeResult) => string | null,
  labelFn: (key: string) => string
): BreakdownRow[] {
  const buckets = new Map<
    string,
    { scores: number[]; correct: number; partial: number; incorrect: number }
  >();

  for (const e of evals) {
    let key: string | null;
    try {
      key = keyFn(e);
    } catch {
      continue;
    }
    if (key == null || key === "") continue;

    let b = buckets.get(key);
    if (!b) {
      b = { scores: [], correct: 0, partial: 0, incorrect: 0 };
      buckets.set(key, b);
    }
    b.scores.push(evalDisplayScore(e));
    if (e.verdict === "correct") b.correct += 1;
    else if (e.verdict === "partial") b.partial += 1;
    else if (e.verdict === "incorrect") b.incorrect += 1;
  }

  const rows: BreakdownRow[] = [];
  for (const [key, b] of buckets) {
    const count = b.scores.length;
    if (count === 0) continue;
    const avgScore = b.scores.reduce((a, n) => a + n, 0) / count;
    rows.push({
      key,
      label: labelFn(key),
      count,
      avgScore,
      correctPct: (b.correct / count) * 100,
      correct: b.correct,
      partial: b.partial,
      incorrect: b.incorrect,
    });
  }

  return rows.sort((a, b) => a.avgScore - b.avgScore);
}

function VerdictSplitBar({
  correct,
  partial,
  incorrect,
  total,
}: {
  correct: number;
  partial: number;
  incorrect: number;
  total: number;
}) {
  if (total === 0) {
    return <div className="h-1.5 w-full min-w-[4rem] rounded-full bg-[var(--border)]" />;
  }
  const c = (correct / total) * 100;
  const p = (partial / total) * 100;
  const i = (incorrect / total) * 100;
  return (
    <div
      className="flex h-1.5 w-full min-w-[4rem] overflow-hidden rounded-full bg-[var(--border)]"
      title={`correct ${correct}, partial ${partial}, incorrect ${incorrect}`}
    >
      {c > 0 && (
        <div className="bg-[var(--accent)]" style={{ width: `${c}%` }} />
      )}
      {p > 0 && (
        <div className="bg-amber-400" style={{ width: `${p}%` }} />
      )}
      {i > 0 && <div className="bg-red-400" style={{ width: `${i}%` }} />}
    </div>
  );
}

function BreakdownTable({
  sectionLabel,
  dimensionLabel,
  rows,
}: {
  sectionLabel: string;
  dimensionLabel: string;
  rows: BreakdownRow[];
}) {
  if (rows.length === 0) return null;

  return (
    <div>
      <p className="text-[var(--muted)] text-xs uppercase tracking-wider mb-2">
        {sectionLabel}
      </p>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="text-[var(--muted)] uppercase tracking-wide border-b border-[var(--border)]">
              <th className="px-2.5 py-1.5 font-medium">{dimensionLabel}</th>
              <th className="px-2.5 py-1.5 font-medium text-right w-12">Count</th>
              <th className="px-2.5 py-1.5 font-medium text-right w-16">Avg Score</th>
              <th className="px-2.5 py-1.5 font-medium text-right w-14">Correct %</th>
              <th className="px-2.5 py-1.5 font-medium min-w-[5rem]">Split</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className="border-b border-[var(--border)]/80 last:border-0"
              >
                <td className="px-2.5 py-1.5 text-[var(--text)]">{row.label}</td>
                <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-[var(--muted)]">
                  {row.count}
                </td>
                <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-[var(--text)]">
                  {row.avgScore.toFixed(1)}
                </td>
                <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-[var(--muted)]">
                  {row.correctPct.toFixed(0)}%
                </td>
                <td className="px-2.5 py-1.5">
                  <VerdictSplitBar
                    correct={row.correct}
                    partial={row.partial}
                    incorrect={row.incorrect}
                    total={row.count}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type EvalSummaryProps = {
  evals: FullJudgeResult[];
  /** Queries on this deploy (for "judged X of Y" hint). */
  momentCount?: number;
};

export function EvalSummary({ evals, momentCount }: EvalSummaryProps) {
  if (evals.length === 0) {
    const pending =
      momentCount != null && momentCount > 0
        ? ` (${momentCount} quer${momentCount === 1 ? "y" : "ies"} on this deploy — none judged yet for current SQL)`
        : "";
    return (
      <p className="text-sm text-[var(--muted)]">
        No judged queries for this deploy yet{pending} — run{" "}
        <code className="text-xs font-mono">npm run eval</code> after logging queries,
        then refresh.
      </p>
    );
  }

  const scores = evals.map(evalDisplayScore);
  const avgScore =
    scores.length > 0
      ? scores.reduce((a, n) => a + n, 0) / scores.length
      : 0;

  const correct = evals.filter((e) => e.verdict === "correct").length;
  const partial = evals.filter((e) => e.verdict === "partial").length;
  const incorrect = evals.filter((e) => e.verdict === "incorrect").length;
  const fullEvalCount = evals.filter((e) => e.resultEval != null).length;
  const fullEvalPct =
    evals.length > 0 ? Math.round((fullEvalCount / evals.length) * 100) : 0;

  const categoryRows = buildBreakdown(
    evals,
    (e) => (e.category ? String(e.category) : null),
    (key) => CATEGORY_LABELS[key as QueryCategory] ?? key
  );

  const difficultyRows = buildBreakdown(
    evals,
    (e) => (e.sql ? difficultyFromSql(e.sql) : null),
    (key) => DIFFICULTY_LABELS[key as QueryDifficulty] ?? key
  );

  const datasetRows = buildBreakdown(
    evals,
    (e) => (e.sql ? detectDatasets(e.sql) : null),
    (key) => DATASET_LABELS[key as QueryDataset] ?? key
  );

  const judgedHint =
    momentCount != null && momentCount > evals.length
      ? ` · ${evals.length} judged of ${momentCount} on this deploy`
      : "";

  return (
    <div className="space-y-5">
      {judgedHint ? (
        <p className="text-xs text-[var(--muted)]">
          Eval summary{judgedHint} (exact SQL match; re-run{" "}
          <code className="font-mono">npm run eval</code> after new queries)
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <StatPill label="Total evals" value={String(evals.length)} />
        <StatPill
          label="Avg score"
          value={
            <span className="font-mono tabular-nums">
              {avgScore.toFixed(1)} / 5
            </span>
          }
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[var(--muted)] uppercase tracking-wide mr-1">
            Verdicts
          </span>
          <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-[var(--accent)]/20 text-[var(--accent)]">
            correct {correct}
          </span>
          <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-amber-400/20 text-amber-400">
            partial {partial}
          </span>
          <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-red-400/20 text-red-400">
            incorrect {incorrect}
          </span>
        </div>
        <StatPill label="Full eval" value={`${fullEvalPct}%`} mono />
      </div>

      <BreakdownTable
        sectionLabel="By Category"
        dimensionLabel="Name"
        rows={categoryRows}
      />
      <BreakdownTable
        sectionLabel="By Difficulty"
        dimensionLabel="Name"
        rows={difficultyRows}
      />
      <BreakdownTable
        sectionLabel="By Dataset"
        dimensionLabel="Name"
        rows={datasetRows}
      />
    </div>
  );
}

function StatPill({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p
        className={`text-sm font-medium text-[var(--text)] mt-0.5 ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
