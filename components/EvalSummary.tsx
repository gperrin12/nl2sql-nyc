"use client";

import type { ReactNode } from "react";
import type { DashboardJudgeView } from "@/lib/dashboard-judge-view";
import type { CorrectnessVerdict } from "@/lib/judge";
import type { QueryCategory } from "@/lib/query-category";
import { DATASET_LABELS, type QueryDataset } from "@/lib/query-dataset";
import { DIFFICULTY_LABELS, type QueryDifficulty } from "@/lib/query-difficulty";

export type BreakdownDimension =
  | "category"
  | "difficulty"
  | "dataset"
  | "hallucination"
  | "verdict";

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

const HALLUCINATION_LABELS: Record<string, string> = {
  none: "None",
  off_topic: "Off topic",
  guardrail_blocked: "Guardrail blocked",
  no_sql_produced: "No SQL",
  schema_hallucination: "Schema hallucination",
};

function buildBreakdown(
  rows: DashboardJudgeView[],
  keyFn: (e: DashboardJudgeView) => string | null,
  labelFn: (key: string) => string
): BreakdownRow[] {
  const buckets = new Map<
    string,
    { scores: number[]; correct: number; partial: number; incorrect: number }
  >();

  for (const e of rows) {
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
    b.scores.push(e.overall);
    if (e.verdict === "correct") b.correct += 1;
    else if (e.verdict === "partial") b.partial += 1;
    else if (e.verdict === "incorrect") b.incorrect += 1;
  }

  const out: BreakdownRow[] = [];
  for (const [key, b] of buckets) {
    const count = b.scores.length;
    if (count === 0) continue;
    const avgScore = b.scores.reduce((a, n) => a + n, 0) / count;
    out.push({
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

  return out.sort((a, b) => a.avgScore - b.avgScore);
}

function buildHallucinationBreakdown(
  counts: Record<string, number>
): BreakdownRow[] {
  return Object.entries(counts)
    .map(([key, count]) => ({
      key,
      label: HALLUCINATION_LABELS[key] ?? key,
      count,
      avgScore: 0,
      correctPct: 0,
      correct: 0,
      partial: 0,
      incorrect: 0,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
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
  dimension,
  rows,
  showScoreColumns = true,
  selectedKey,
  onRowSelect,
}: {
  sectionLabel: string;
  dimensionLabel: string;
  dimension: BreakdownDimension;
  rows: BreakdownRow[];
  showScoreColumns?: boolean;
  selectedKey?: string | null;
  onRowSelect?: (dimension: BreakdownDimension, key: string) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <div>
      <p className="text-[var(--muted)] text-xs uppercase tracking-wider mb-2">
        {sectionLabel}
        {onRowSelect ? (
          <span className="normal-case tracking-normal text-[var(--muted)]/80 ml-1">
            · click to filter
          </span>
        ) : null}
      </p>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="text-[var(--muted)] uppercase tracking-wide border-b border-[var(--border)]">
              <th className="px-2.5 py-1.5 font-medium">{dimensionLabel}</th>
              <th className="px-2.5 py-1.5 font-medium text-right w-12">Count</th>
              {showScoreColumns ? (
                <>
                  <th className="px-2.5 py-1.5 font-medium text-right w-16">
                    Avg Score
                  </th>
                  <th className="px-2.5 py-1.5 font-medium text-right w-14">
                    Correct %
                  </th>
                  <th className="px-2.5 py-1.5 font-medium min-w-[5rem]">
                    Split
                  </th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const selected = selectedKey === row.key;
              return (
                <tr
                  key={row.key}
                  onClick={() => onRowSelect?.(dimension, row.key)}
                  className={`border-b border-[var(--border)]/80 last:border-0 ${
                    onRowSelect
                      ? "cursor-pointer hover:bg-white/[0.04] transition-colors"
                      : ""
                  } ${selected ? "bg-[var(--accent)]/15 ring-1 ring-inset ring-[var(--accent)]/40" : ""}`}
                >
                  <td className="px-2.5 py-1.5 text-[var(--text)]">{row.label}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-[var(--muted)]">
                    {row.count}
                  </td>
                  {showScoreColumns ? (
                    <>
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
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export type EvalSummaryProps = {
  rows: DashboardJudgeView[];
  hallucinationCounts: Record<string, number>;
  avgCostUsd: number | null;
  avgTotalTokens: number | null;
  activeFilters?: Partial<Record<BreakdownDimension, string>>;
  onBreakdownSelect?: (dimension: BreakdownDimension, key: string) => void;
};

export function EvalSummary({
  rows,
  hallucinationCounts,
  avgCostUsd,
  avgTotalTokens,
  activeFilters,
  onBreakdownSelect,
}: EvalSummaryProps) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        No judged queries match the current filters — adjust filters above or run{" "}
        <code className="text-xs font-mono">npm run eval</code> to backfill scores.
      </p>
    );
  }

  const avgScore = rows.reduce((a, e) => a + e.overall, 0) / rows.length;

  const correct = rows.filter((e) => e.verdict === "correct").length;
  const partial = rows.filter((e) => e.verdict === "partial").length;
  const incorrect = rows.filter((e) => e.verdict === "incorrect").length;

  const categoryRows = buildBreakdown(
    rows,
    (e) => String(e.category),
    (key) => CATEGORY_LABELS[key as QueryCategory] ?? key
  );

  const difficultyRows = buildBreakdown(
    rows,
    (e) => String(e.difficulty),
    (key) => DIFFICULTY_LABELS[key as QueryDifficulty] ?? key
  );

  const datasetRows = buildBreakdown(
    rows,
    (e) => String(e.dataset),
    (key) => DATASET_LABELS[key as QueryDataset] ?? key
  );

  const hallucinationRows = buildHallucinationBreakdown(hallucinationCounts);

  const verdictKeys: CorrectnessVerdict[] = ["correct", "partial", "incorrect"];

  return (
    <div className="space-y-5">
      <p className="text-xs text-[var(--muted)]">
        Breakdowns for the filtered result set · click a row to drill down
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <StatPill label="Judged queries" value={String(rows.length)} />
        <StatPill
          label="Avg score"
          value={
            <span className="font-mono tabular-nums">
              {avgScore.toFixed(1)} / 5
            </span>
          }
        />
        <StatPill
          label="Avg cost"
          value={
            <span className="font-mono tabular-nums">
              {avgCostUsd != null ? `$${avgCostUsd.toFixed(4)}` : "—"}
            </span>
          }
        />
        <StatPill
          label="Avg tokens"
          value={
            <span className="font-mono tabular-nums">
              {avgTotalTokens != null ? String(Math.round(avgTotalTokens)) : "—"}
            </span>
          }
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[var(--muted)] uppercase tracking-wide mr-1">
            Verdicts
          </span>
          {verdictKeys.map((v) => {
            const count =
              v === "correct" ? correct : v === "partial" ? partial : incorrect;
            const active = activeFilters?.verdict === v;
            const colorClass =
              v === "correct"
                ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                : v === "partial"
                  ? "bg-amber-400/20 text-amber-400"
                  : "bg-red-400/20 text-red-400";
            return (
              <button
                key={v}
                type="button"
                onClick={() => onBreakdownSelect?.("verdict", v)}
                className={`px-2 py-0.5 rounded-full text-xs font-mono transition-colors ${
                  active
                    ? `${colorClass} ring-1 ring-inset ring-current`
                    : `${colorClass} hover:opacity-90`
                }`}
              >
                {v} {count}
              </button>
            );
          })}
        </div>
      </div>

      <BreakdownTable
        sectionLabel="By Category"
        dimensionLabel="Name"
        dimension="category"
        rows={categoryRows}
        selectedKey={activeFilters?.category}
        onRowSelect={onBreakdownSelect}
      />
      <BreakdownTable
        sectionLabel="By Difficulty"
        dimensionLabel="Name"
        dimension="difficulty"
        rows={difficultyRows}
        selectedKey={activeFilters?.difficulty}
        onRowSelect={onBreakdownSelect}
      />
      <BreakdownTable
        sectionLabel="By Dataset"
        dimensionLabel="Name"
        dimension="dataset"
        rows={datasetRows}
        selectedKey={activeFilters?.dataset}
        onRowSelect={onBreakdownSelect}
      />
      <BreakdownTable
        sectionLabel="By Hallucination"
        dimensionLabel="Type"
        dimension="hallucination"
        rows={hallucinationRows}
        showScoreColumns={false}
        selectedKey={activeFilters?.hallucination}
        onRowSelect={onBreakdownSelect}
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
