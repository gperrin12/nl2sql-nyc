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
  goodPct: number;
  good: number;
  acceptable: number;
  poor: number;
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
        : (e.scores.validity +
            e.scores.intent +
            e.scores.compliance +
            e.scores.efficiency) /
          4;
    return blendJudgeOverall(sql, re.resultQuality, re.vizFit);
  }
  return (
    e.scores.validity +
    e.scores.intent +
    e.scores.compliance +
    e.scores.efficiency
  ) / 4;
}

function buildBreakdown(
  evals: FullJudgeResult[],
  keyFn: (e: FullJudgeResult) => string | null,
  labelFn: (key: string) => string
): BreakdownRow[] {
  const buckets = new Map<
    string,
    { scores: number[]; good: number; acceptable: number; poor: number }
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
      b = { scores: [], good: 0, acceptable: 0, poor: 0 };
      buckets.set(key, b);
    }
    b.scores.push(evalDisplayScore(e));
    if (e.verdict === "good") b.good += 1;
    else if (e.verdict === "acceptable") b.acceptable += 1;
    else if (e.verdict === "poor") b.poor += 1;
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
      goodPct: (b.good / count) * 100,
      good: b.good,
      acceptable: b.acceptable,
      poor: b.poor,
    });
  }

  return rows.sort((a, b) => a.avgScore - b.avgScore);
}

function VerdictSplitBar({
  good,
  acceptable,
  poor,
  total,
}: {
  good: number;
  acceptable: number;
  poor: number;
  total: number;
}) {
  if (total === 0) {
    return <div className="h-1.5 w-full min-w-[4rem] rounded-full bg-[var(--border)]" />;
  }
  const g = (good / total) * 100;
  const a = (acceptable / total) * 100;
  const p = (poor / total) * 100;
  return (
    <div
      className="flex h-1.5 w-full min-w-[4rem] overflow-hidden rounded-full bg-[var(--border)]"
      title={`good ${good}, acceptable ${acceptable}, poor ${poor}`}
    >
      {g > 0 && (
        <div className="bg-[var(--accent)]" style={{ width: `${g}%` }} />
      )}
      {a > 0 && (
        <div className="bg-amber-400" style={{ width: `${a}%` }} />
      )}
      {p > 0 && <div className="bg-red-400" style={{ width: `${p}%` }} />}
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
              <th className="px-2.5 py-1.5 font-medium text-right w-14">Good %</th>
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
                  {row.goodPct.toFixed(0)}%
                </td>
                <td className="px-2.5 py-1.5">
                  <VerdictSplitBar
                    good={row.good}
                    acceptable={row.acceptable}
                    poor={row.poor}
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

  const good = evals.filter((e) => e.verdict === "good").length;
  const acceptable = evals.filter((e) => e.verdict === "acceptable").length;
  const poor = evals.filter((e) => e.verdict === "poor").length;
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
              {avgScore.toFixed(1)} / 10
            </span>
          }
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[var(--muted)] uppercase tracking-wide mr-1">
            Verdicts
          </span>
          <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-[var(--accent)]/20 text-[var(--accent)]">
            good {good}
          </span>
          <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-amber-400/20 text-amber-400">
            acceptable {acceptable}
          </span>
          <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-red-400/20 text-red-400">
            poor {poor}
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
