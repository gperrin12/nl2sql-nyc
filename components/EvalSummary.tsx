"use client";

import type { FullJudgeResult } from "@/lib/judge";
import type { QueryCategory } from "@/lib/query-category";
import {
  DATASET_LABELS,
  detectDatasets,
  type QueryDataset,
} from "@/lib/query-dataset";
import { sqlComplexity } from "@/lib/sql-metrics";

type Verdict = FullJudgeResult["verdict"];

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

type QueryDifficulty = "easy" | "medium" | "hard";

const DIFFICULTY_LABELS: Record<QueryDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

function difficultyFromSql(sql: string): QueryDifficulty {
  const { score } = sqlComplexity(sql);
  if (score < 6) return "easy";
  if (score < 14) return "medium";
  return "hard";
}

function buildBreakdown(
  evals: FullJudgeResult[],
  keyFn: (e: FullJudgeResult) => string,
  labelFn: (key: string) => string
): BreakdownRow[] {
  const buckets = new Map<
    string,
    { scores: number[]; good: number; acceptable: number; poor: number }
  >();

  for (const e of evals) {
    const key = keyFn(e);
    let b = buckets.get(key);
    if (!b) {
      b = { scores: [], good: 0, acceptable: 0, poor: 0 };
      buckets.set(key, b);
    }
    b.scores.push(e.overall);
    if (e.verdict === "good") b.good += 1;
    else if (e.verdict === "acceptable") b.acceptable += 1;
    else b.poor += 1;
  }

  const rows: BreakdownRow[] = [];
  for (const [key, b] of buckets) {
    const count = b.scores.length;
    const avgScore =
      count > 0 ? b.scores.reduce((a, n) => a + n, 0) / count : 0;
    rows.push({
      key,
      label: labelFn(key),
      count,
      avgScore,
      goodPct: count > 0 ? (b.good / count) * 100 : 0,
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
    return <div className="h-2 rounded-full bg-[var(--border)]" />;
  }
  const g = (good / total) * 100;
  const a = (acceptable / total) * 100;
  const p = (poor / total) * 100;
  return (
    <div
      className="flex h-2 w-full min-w-[5rem] overflow-hidden rounded-full bg-[var(--border)]"
      title={`good ${good}, acceptable ${acceptable}, poor ${poor}`}
    >
      {g > 0 && (
        <div className="bg-green-500/80" style={{ width: `${g}%` }} />
      )}
      {a > 0 && (
        <div className="bg-amber-500/80" style={{ width: `${a}%` }} />
      )}
      {p > 0 && <div className="bg-red-500/80" style={{ width: `${p}%` }} />}
    </div>
  );
}

function BreakdownTable({
  title,
  dimensionLabel,
  rows,
}: {
  title: string;
  dimensionLabel: string;
  rows: BreakdownRow[];
}) {
  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
      <div className="px-4 py-2 border-b border-[var(--border)]">
        <h3 className="text-sm font-medium text-[var(--text)]">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
              <th className="px-4 py-2 font-medium">{dimensionLabel}</th>
              <th className="px-4 py-2 font-medium text-right w-16">Count</th>
              <th className="px-4 py-2 font-medium text-right w-20">Avg Score</th>
              <th className="px-4 py-2 font-medium text-right w-20">Good %</th>
              <th className="px-4 py-2 font-medium min-w-[8rem]">Verdicts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className="border-b border-[var(--border)] last:border-0"
              >
                <td className="px-4 py-2 text-[var(--text)]">{row.label}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">
                  {row.count}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text)]">
                  {row.avgScore.toFixed(1)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">
                  {row.goodPct.toFixed(0)}%
                </td>
                <td className="px-4 py-2">
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
};

export function EvalSummary({ evals }: EvalSummaryProps) {
  const categoryRows = buildBreakdown(
    evals,
    (e) => e.category,
    (key) => CATEGORY_LABELS[key as QueryCategory] ?? key
  );

  const difficultyRows = buildBreakdown(
    evals,
    (e) => difficultyFromSql(e.sql),
    (key) => DIFFICULTY_LABELS[key as QueryDifficulty] ?? key
  );

  const datasetRows = buildBreakdown(
    evals,
    (e) => detectDatasets(e.sql),
    (key) => DATASET_LABELS[key as QueryDataset] ?? key
  );

  if (evals.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        No judged queries yet — run <code className="text-xs">npm run eval</code>{" "}
        to populate scores.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <BreakdownTable
        title="By category"
        dimensionLabel="Category"
        rows={categoryRows}
      />
      <BreakdownTable
        title="By difficulty"
        dimensionLabel="Difficulty"
        rows={difficultyRows}
      />
      <BreakdownTable
        title="By dataset"
        dimensionLabel="Dataset"
        rows={datasetRows}
      />
    </div>
  );
}
