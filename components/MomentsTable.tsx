"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { evalMatchesMoment } from "@/lib/eval-match";
import type { FullJudgeResult } from "@/lib/judge";
import type { DashboardMoment } from "@/lib/p8k8-moments";
import {
  classifyQuestion,
  type QueryCategory,
} from "@/lib/query-category";
import {
  formatJudgeCellTooltip,
  formatJudgeHeaderTooltip,
  formatSqlJudgeHeaderTooltip,
  getSqlOverall,
  JUDGE_BLEND_DIVISOR,
} from "@/lib/judge-display";
import { formatLatencyMs } from "@/lib/sql-metrics";

const COLUMN_STORAGE_KEY = "nl2sql-dashboard-columns-v6";

export type MomentColumnId =
  | "timestamp"
  | "question"
  | "category"
  | "words"
  | "latency"
  | "sql"
  | "cplx"
  | "model"
  | "athena"
  | "tokens"
  | "sqlJudge"
  | "judge"
  | "resultQuality"
  | "vizFit";

type ColumnDef = {
  id: MomentColumnId;
  label: string;
  defaultVisible: boolean;
  headerClass?: string;
  cellClass?: string;
};

const COLUMN_DEFS: ColumnDef[] = [
  {
    id: "timestamp",
    label: "Timestamp",
    defaultVisible: true,
    headerClass: "w-[6.5rem]",
    cellClass: "whitespace-nowrap text-[var(--muted)]",
  },
  {
    id: "question",
    label: "Question",
    defaultVisible: true,
    cellClass: "text-[var(--text)]",
  },
  {
    id: "category",
    label: "Category",
    defaultVisible: true,
    headerClass: "w-[7.5rem]",
  },
  {
    id: "words",
    label: "Words",
    defaultVisible: false,
    headerClass: "w-[4rem]",
    cellClass: "tabular-nums text-[var(--muted)]",
  },
  {
    id: "latency",
    label: "Latency",
    defaultVisible: false,
    headerClass: "w-[5rem]",
    cellClass: "tabular-nums text-[var(--muted)] whitespace-nowrap",
  },
  {
    id: "sql",
    label: "SQL",
    defaultVisible: true,
    cellClass: "font-mono text-xs text-[var(--muted)]",
  },
  {
    id: "cplx",
    label: "Cplx",
    defaultVisible: false,
    headerClass: "w-[3.5rem]",
    cellClass: "tabular-nums text-[var(--muted)]",
  },
  {
    id: "model",
    label: "Model",
    defaultVisible: true,
    headerClass: "w-[8rem]",
  },
  {
    id: "athena",
    label: "Athena",
    defaultVisible: true,
    headerClass: "w-[6rem]",
    cellClass: "font-mono text-xs whitespace-nowrap",
  },
  {
    id: "tokens",
    label: "Tokens",
    defaultVisible: false,
    headerClass: "w-[4.5rem] text-right",
    cellClass: "text-right tabular-nums text-[var(--muted)]",
  },
  {
    id: "sqlJudge",
    label: "SQL",
    defaultVisible: true,
    headerClass: "w-[4.5rem] text-right",
    cellClass: "text-right tabular-nums whitespace-nowrap",
  },
  {
    id: "judge",
    label: "Judge",
    defaultVisible: true,
    headerClass: "w-[5.5rem] text-right",
    cellClass: "text-right tabular-nums whitespace-nowrap",
  },
  {
    id: "resultQuality",
    label: "Result",
    defaultVisible: true,
    headerClass: "w-[4.5rem] text-right",
    cellClass: "text-right tabular-nums whitespace-nowrap",
  },
  {
    id: "vizFit",
    label: "Viz",
    defaultVisible: true,
    headerClass: "w-[3.5rem] text-right",
    cellClass: "text-right tabular-nums whitespace-nowrap",
  },
];

const DEFAULT_VISIBLE = new Set(
  COLUMN_DEFS.filter((c) => c.defaultVisible).map((c) => c.id)
);

function loadVisibleColumns(): Set<MomentColumnId> {
  if (typeof window === "undefined") return new Set(DEFAULT_VISIBLE);
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!raw) return new Set(DEFAULT_VISIBLE);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set(DEFAULT_VISIBLE);
    const valid = new Set(COLUMN_DEFS.map((c) => c.id));
    const ids = parsed.filter(
      (id): id is MomentColumnId =>
        typeof id === "string" && valid.has(id as MomentColumnId)
    );
    if (ids.length === 0) return new Set(DEFAULT_VISIBLE);
    return new Set(ids);
  } catch {
    return new Set(DEFAULT_VISIBLE);
  }
}

function saveVisibleColumns(visible: Set<MomentColumnId>): void {
  localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify([...visible]));
}

type Props = {
  moments: DashboardMoment[];
  evalByMomentId: Map<string, FullJudgeResult>;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  offset: number;
  total: number;
  pageSize: number;
  onPageChange: (offset: number) => void;
  /** When filters yield no rows (overrides default empty copy). */
  emptyMessage?: string;
};

const CATEGORY_STYLES: Record<QueryCategory, string> = {
  spatial: "bg-blue-500/20 text-blue-400",
  demographic: "bg-pink-500/20 text-pink-400",
  "time-series": "bg-amber-500/20 text-amber-400",
  ranking: "bg-purple-500/20 text-purple-400",
  comparison: "bg-orange-500/20 text-orange-400",
  aggregation: "bg-green-500/20 text-green-400",
  lookup: "bg-gray-500/20 text-gray-400",
  other: "bg-gray-500/20 text-gray-400",
};

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hours ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)} days ago`;
  return new Date(iso).toLocaleDateString();
}

function truncateSql(sql: string, max = 48): string {
  const oneLine = sql.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

function judgeScoreColor(overall: number): string {
  if (overall >= 8) return "text-green-400";
  if (overall <= 4) return "text-red-400";
  return "text-amber-400";
}

function verdictBadgeClass(verdict: FullJudgeResult["verdict"]): string {
  if (verdict === "good") return "bg-green-500/20 text-green-400 border-green-500/30";
  if (verdict === "poor") return "bg-red-500/20 text-red-400 border-red-500/30";
  return "bg-amber-500/20 text-amber-400 border-amber-500/30";
}

function CategoryBadge({ category }: { category: QueryCategory }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs capitalize whitespace-nowrap ${CATEGORY_STYLES[category]}`}
    >
      {category}
    </span>
  );
}

function HoverTooltip({
  children,
  tooltip,
  className,
  align = "left",
  placement = "below",
}: {
  children: React.ReactNode;
  tooltip: string;
  className?: string;
  align?: "left" | "right";
  placement?: "above" | "below";
}) {
  const [show, setShow] = useState(false);
  if (!tooltip) {
    return <span className={className}>{children}</span>;
  }
  const positionClass =
    placement === "above"
      ? "bottom-full mb-1.5"
      : "top-full mt-1.5";
  return (
    <span
      className={`relative inline-flex ${className ?? ""}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <span
          role="tooltip"
          className={`absolute z-[100] w-max max-w-[18rem] whitespace-pre-line rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-[11px] font-normal normal-case leading-snug text-[var(--text)] shadow-xl pointer-events-none ${positionClass} ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {tooltip}
        </span>
      )}
    </span>
  );
}

function columnHeaderTitle(id: MomentColumnId): string | undefined {
  if (id === "sqlJudge") return formatSqlJudgeHeaderTooltip();
  if (id === "judge") return formatJudgeHeaderTooltip();
  if (id === "cplx") return "Complexity score";
  if (id === "resultQuality") return "Result quality (0–10): does Athena data answer the question?";
  if (id === "vizFit") return "Viz fit (0–10): is map/chart/table right for this question?";
  if (id === "athena") return "Athena execution state from nl2sql.query_runs";
  return undefined;
}

function athenaStateClass(state: string | null | undefined): string {
  const s = (state ?? "").toUpperCase();
  if (s === "SUCCEEDED") return "text-emerald-400";
  if (s === "FAILED" || s === "CANCELLED") return "text-[var(--error)]";
  if (s === "RUNNING") return "text-[var(--accent)]";
  return "text-[var(--muted)]";
}

function complexityTooltip(m: DashboardMoment): string {
  const c = m.sqlComplexity;
  return `${c.cteCount} CTEs, ${c.joinCount} JOINs, ${c.tableCount} tables, ${c.charLength} chars`;
}

function SkeletonRows({ colCount }: { colCount: number }) {
  return (
    <tbody>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="border-t border-[var(--border)]">
          {Array.from({ length: colCount }).map((__, j) => (
            <td key={j} className="px-3 py-3">
              <div className="h-4 bg-[var(--border)] rounded animate-pulse w-full" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

function ExpandedSqlToolbar({
  copied,
  onCopy,
}: {
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onCopy}
        className="text-xs text-[var(--accent)] hover:text-[var(--accent-dim)]"
      >
        {copied ? "Copied!" : "Copy SQL"}
      </button>
    </div>
  );
}

function MomentRow({
  moment: m,
  evalResult,
  evalSqlDiffers,
  expanded,
  onToggle,
  copied,
  onCopy,
  visibleColumns,
  colCount,
}: {
  moment: DashboardMoment;
  evalResult: FullJudgeResult | undefined;
  evalSqlDiffers: boolean;
  expanded: boolean;
  onToggle: () => void;
  copied: boolean;
  onCopy: () => void;
  visibleColumns: ColumnDef[];
  colCount: number;
}) {
  const category = evalResult?.category ?? classifyQuestion(m.question);
  const visible = new Set(visibleColumns.map((c) => c.id));

  const renderCell = (id: MomentColumnId) => {
    switch (id) {
      case "timestamp":
        return formatRelativeTime(m.timestamp);
      case "question":
        return (
          <span className="line-clamp-2" title={m.question}>
            {m.question}
          </span>
        );
      case "category":
        return <CategoryBadge category={category} />;
      case "words":
        return m.questionMetrics.wordCount;
      case "latency":
        return formatLatencyMs(m.latencyMs);
      case "sql":
        return (
          <>
            {!expanded && (
              <span
                className="line-clamp-1"
                title={m.sql.replace(/\s+/g, " ").trim()}
              >
                {truncateSql(m.sql)}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className="mt-0.5 block text-[var(--accent)] hover:text-[var(--accent-dim)]"
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
          </>
        );
      case "cplx":
        return (
          <span title={complexityTooltip(m)}>{m.sqlComplexity.score}</span>
        );
      case "model":
        return m.model ? (
          <span
            className="inline-block max-w-full truncate px-2 py-0.5 rounded border border-[var(--border)] text-xs text-[var(--accent)]"
            title={m.model}
          >
            {m.model}
          </span>
        ) : (
          "—"
        );
      case "athena":
        return m.athenaState ? (
          <span
            className={athenaStateClass(m.athenaState)}
            title={m.executionId ?? undefined}
          >
            {m.athenaState}
          </span>
        ) : (
          "—"
        );
      case "tokens":
        return m.tokenCount ?? "—";
      case "sqlJudge":
        return evalResult ? (
          <span className={judgeScoreColor(getSqlOverall(evalResult))}>
            {getSqlOverall(evalResult).toFixed(1)}/10
          </span>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        );
      case "judge":
        return evalResult ? (
          <HoverTooltip
            tooltip={formatJudgeCellTooltip(evalResult)}
            align="right"
            className="cursor-help border-b border-dotted border-[var(--muted)]"
          >
            <span className={judgeScoreColor(evalResult.overall)}>
              {evalResult.overall.toFixed(1)}/10
            </span>
          </HoverTooltip>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        );
      case "resultQuality":
        return evalResult?.resultEval != null ? (
          <span className={judgeScoreColor(evalResult.resultEval.resultQuality)}>
            {evalResult.resultEval.resultQuality.toFixed(1)}/10
          </span>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        );
      case "vizFit":
        return evalResult?.resultEval != null ? (
          <span className={judgeScoreColor(evalResult.resultEval.vizFit)}>
            {evalResult.resultEval.vizFit.toFixed(1)}/10
          </span>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <tr
        className={`border-t border-[var(--border)] hover:bg-white/[0.02] ${expanded ? "bg-white/[0.03]" : "cursor-pointer"}`}
        onClick={() => {
          if (!expanded) onToggle();
        }}
      >
        {visibleColumns.map((col) => {
          const def = COLUMN_DEFS.find((c) => c.id === col.id)!;
          const extra =
            col.id === "timestamp"
              ? { title: new Date(m.timestamp).toLocaleString() }
              : col.id === "words"
                ? { title: `${m.questionMetrics.charCount} characters` }
                : {};
          return (
            <td
              key={col.id}
              className={`px-3 py-3 align-top ${def.cellClass ?? ""}`}
              {...extra}
            >
              {renderCell(col.id)}
            </td>
          );
        })}
      </tr>
      {expanded && (
        <tr className="border-t border-[var(--border)] bg-black/20">
          <td colSpan={colCount} className="px-4 py-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                  Question
                </p>
                <p className="text-sm text-[var(--text)]">{m.question}</p>
              </div>
              <button
                type="button"
                onClick={onToggle}
                className="text-xs text-[var(--muted)] hover:text-[var(--text)] shrink-0"
              >
                Collapse
              </button>
            </div>

            <p className="text-xs text-[var(--muted)]">
              SQL complexity: {m.sqlComplexity.cteCount} CTE
              {m.sqlComplexity.cteCount === 1 ? "" : "s"},{" "}
              {m.sqlComplexity.joinCount} JOIN
              {m.sqlComplexity.joinCount === 1 ? "" : "s"},{" "}
              {m.sqlComplexity.tableCount} table
              {m.sqlComplexity.tableCount === 1 ? "" : "s"},{" "}
              {m.sqlComplexity.charLength.toLocaleString()} chars (score{" "}
              {m.sqlComplexity.score})
              {!visible.has("latency") && m.latencyMs != null && (
                <> · latency {formatLatencyMs(m.latencyMs)}</>
              )}
              {!visible.has("words") && (
                <> · {m.questionMetrics.wordCount} words</>
              )}
              {!visible.has("tokens") && m.tokenCount != null && (
                <> · {m.tokenCount} tokens</>
              )}
            </p>

            {evalResult && (
              <div className="space-y-2">
                <div>
                  <span
                    className={`inline-block px-2 py-0.5 rounded border text-xs capitalize ${verdictBadgeClass(evalResult.verdict)}`}
                  >
                    {evalResult.verdict}
                  </span>
                </div>
                <p className="text-xs text-[var(--muted)] font-mono">
                  SQL judge: {getSqlOverall(evalResult).toFixed(1)}/10
                  {evalResult.resultEval ? (
                    <>
                      {" "}
                      · Judge = (SQL {getSqlOverall(evalResult).toFixed(1)} + 2×Result{" "}
                      {evalResult.resultEval.resultQuality.toFixed(1)} + Viz{" "}
                      {evalResult.resultEval.vizFit.toFixed(1)}) / {JUDGE_BLEND_DIVISOR} →{" "}
                      {evalResult.overall.toFixed(1)}/10
                    </>
                  ) : null}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="rounded border border-[var(--border)] px-2 py-1.5">
                    <span className="text-[var(--muted)]">Validity</span>
                    <p className="font-mono text-[var(--text)]">
                      {evalResult.scores.validity}/10
                    </p>
                  </div>
                  <div className="rounded border border-[var(--border)] px-2 py-1.5">
                    <span className="text-[var(--muted)]">Intent</span>
                    <p className="font-mono text-[var(--text)]">
                      {evalResult.scores.intent}/10
                    </p>
                  </div>
                  <div className="rounded border border-[var(--border)] px-2 py-1.5">
                    <span className="text-[var(--muted)]">Compliance</span>
                    <p className="font-mono text-[var(--text)]">
                      {evalResult.scores.compliance}/10
                    </p>
                  </div>
                  <div className="rounded border border-[var(--border)] px-2 py-1.5">
                    <span className="text-[var(--muted)]">Efficiency</span>
                    <p className="font-mono text-[var(--text)]">
                      {evalResult.scores.efficiency}/10
                    </p>
                  </div>
                </div>
                {evalResult.issues.length > 0 && (
                  <ul className="text-xs space-y-1">
                    {evalResult.issues.map((issue, i) => (
                      <li
                        key={i}
                        className={
                          evalResult.verdict === "poor"
                            ? "text-red-400"
                            : "text-amber-400"
                        }
                      >
                        • {issue}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {evalResult?.resultEval && (
              <div className="space-y-2 border-t border-[var(--border)] pt-3">
                {evalSqlDiffers && (
                  <p className="text-xs text-amber-400/90">
                    Full eval from replay SQL (differs from p8k8 snapshot below).
                  </p>
                )}
                <p className="text-xs text-[var(--muted)]">
                  Result: {evalResult.resultEval.athenaStatus}
                  {evalResult.resultEval.rowCount != null &&
                    ` · ${evalResult.resultEval.rowCount} rows`}
                  {(evalResult.resultEval.uiVizDescription ??
                    evalResult.resultEval.vizType) &&
                    ` · ${evalResult.resultEval.uiVizDescription ?? evalResult.resultEval.vizType}`}
                </p>
                <div className="flex flex-wrap gap-4 text-xs">
                  <span>
                    Result quality:{" "}
                    <span
                      className={judgeScoreColor(
                        evalResult.resultEval.resultQuality
                      )}
                    >
                      {evalResult.resultEval.resultQuality}/10
                    </span>
                  </span>
                  <span>
                    Viz fit:{" "}
                    <span
                      className={judgeScoreColor(evalResult.resultEval.vizFit)}
                    >
                      {evalResult.resultEval.vizFit}/10
                    </span>
                  </span>
                </div>
                {evalResult.resultEval.resultIssues.length > 0 && (
                  <ul className="text-xs space-y-1">
                    {evalResult.resultEval.resultIssues.map((issue, i) => (
                      <li key={i} className="text-amber-400">
                        • {issue}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <ExpandedSqlToolbar copied={copied} onCopy={onCopy} />
            <pre className="text-xs font-mono text-[var(--text)] whitespace-pre-wrap break-words max-h-80 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg)] p-3">
              {m.sql}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

function ColumnPicker({
  visible,
  onChange,
}: {
  visible: Set<MomentColumnId>;
  onChange: (next: Set<MomentColumnId>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (id: MomentColumnId) => {
    const next = new Set(visible);
    if (next.has(id)) {
      if (next.size <= 1) return;
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange(next);
  };

  const reset = () => onChange(new Set(DEFAULT_VISIBLE));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="px-3 py-1.5 rounded border border-[var(--border)] text-sm text-[var(--muted)] hover:text-[var(--text)]"
        aria-expanded={open}
      >
        Columns
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-lg py-2">
          <p className="px-3 pb-2 text-xs text-[var(--muted)]">Toggle columns</p>
          {COLUMN_DEFS.map((col) => (
            <label
              key={col.id}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text)] hover:bg-white/[0.04] cursor-pointer"
            >
              <input
                type="checkbox"
                checked={visible.has(col.id)}
                onChange={() => toggle(col.id)}
                className="rounded border-[var(--border)]"
              />
              {col.label}
            </label>
          ))}
          <button
            type="button"
            onClick={reset}
            className="mt-2 w-full px-3 py-1.5 text-left text-xs text-[var(--accent)] hover:text-[var(--accent-dim)]"
          >
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

export function MomentsTable({
  moments,
  evalByMomentId,
  loading,
  error,
  onRefresh,
  search,
  onSearchChange,
  offset,
  total,
  pageSize,
  onPageChange,
  emptyMessage,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [visibleIds, setVisibleIds] = useState<Set<MomentColumnId>>(
    () => new Set(DEFAULT_VISIBLE)
  );
  const [columnsReady, setColumnsReady] = useState(false);

  useEffect(() => {
    setVisibleIds(loadVisibleColumns());
    setColumnsReady(true);
  }, []);

  const setVisibleColumns = (next: Set<MomentColumnId>) => {
    setVisibleIds(next);
    saveVisibleColumns(next);
  };

  const visibleColumns = useMemo(
    () => COLUMN_DEFS.filter((c) => visibleIds.has(c.id)),
    [visibleIds]
  );
  const colCount = visibleColumns.length;

  const canPrev = offset > 0;
  const canNext = offset + pageSize < total;
  const page = Math.floor(offset / pageSize) + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const copySql = async (id: string, sql: string) => {
    await navigator.clipboard.writeText(sql);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto overflow-y-visible">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
        <input
          type="search"
          placeholder="Search questions…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 min-w-[12rem] px-3 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
        />
        {columnsReady && (
          <ColumnPicker visible={visibleIds} onChange={setVisibleColumns} />
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="px-3 py-1.5 rounded border border-[var(--border)] text-sm text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 text-sm text-[var(--error)] border-b border-[var(--border)]">
          {error}
        </div>
      )}

      <table className="w-full table-fixed text-sm text-left">
        <colgroup>
          {visibleColumns.map((col) => {
            if (col.id === "question") return <col key={col.id} className="w-[34%]" />;
            if (col.id === "sql") return <col key={col.id} className="w-[20%]" />;
            return <col key={col.id} />;
          })}
        </colgroup>
        <thead className="text-xs uppercase tracking-wide text-[var(--muted)] bg-black/20">
          <tr>
            {visibleColumns.map((col) => (
              <th
                key={col.id}
                className={`px-3 py-3 font-medium ${col.headerClass ?? ""} ${
                  col.id === "judge" ? "overflow-visible" : ""
                }`}
                title={
                  col.id === "judge" ? undefined : columnHeaderTitle(col.id)
                }
              >
                {col.id === "judge" ? (
                  <HoverTooltip
                    tooltip={formatJudgeHeaderTooltip()}
                    placement="above"
                    align="right"
                    className="cursor-help border-b border-dotted border-[var(--muted)] uppercase"
                  >
                    {col.label}
                  </HoverTooltip>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        {loading || !columnsReady ? (
          <SkeletonRows colCount={colCount || DEFAULT_VISIBLE.size} />
        ) : moments.length === 0 ? (
          <tbody>
            <tr>
              <td
                colSpan={colCount}
                className="px-4 py-12 text-center text-[var(--muted)]"
              >
                {emptyMessage ??
                  (search.trim()
                    ? "No queries match your search."
                    : "No query pairs yet. Run npm run eval to populate judge scores.")}
              </td>
            </tr>
          </tbody>
        ) : (
          <tbody>
            {moments.map((m) => {
              const expanded = expandedId === m.id;
              const evalResult = evalByMomentId.get(m.id);
              const evalSqlDiffers =
                evalResult != null &&
                evalResult.resultEval != null &&
                !evalMatchesMoment(evalResult, m);
              return (
                <MomentRow
                  key={m.id}
                  moment={m}
                  evalResult={evalResult}
                  evalSqlDiffers={evalSqlDiffers}
                  expanded={expanded}
                  onToggle={() => setExpandedId(expanded ? null : m.id)}
                  copied={copiedId === m.id}
                  onCopy={() => copySql(m.id, m.sql)}
                  visibleColumns={visibleColumns}
                  colCount={colCount}
                />
              );
            })}
          </tbody>
        )}
      </table>

      {total > pageSize && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] text-xs text-[var(--muted)]">
          <span>
            {offset + 1}–{Math.min(offset + pageSize, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => onPageChange(Math.max(0, offset - pageSize))}
              className="px-2 py-1 rounded border border-[var(--border)] disabled:opacity-40 hover:text-[var(--text)]"
            >
              Prev
            </button>
            <span>
              Page {page} / {pages}
            </span>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => onPageChange(offset + pageSize)}
              className="px-2 py-1 rounded border border-[var(--border)] disabled:opacity-40 hover:text-[var(--text)]"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
