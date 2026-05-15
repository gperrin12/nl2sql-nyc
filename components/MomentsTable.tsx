"use client";

import { useMemo, useState } from "react";
import type { DashboardMoment } from "@/lib/p8k8-moments";
import { formatLatencyMs } from "@/lib/sql-metrics";

const COL_COUNT = 8;

type Props = {
  moments: DashboardMoment[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  offset: number;
  total: number;
  pageSize: number;
  onPageChange: (offset: number) => void;
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

function truncateSql(sql: string, max = 80): string {
  const oneLine = sql.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

function SkeletonCell() {
  return (
    <div className="h-4 bg-[var(--border)] rounded animate-pulse w-full max-w-[12rem]" />
  );
}

function SkeletonRows() {
  return (
    <tbody>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="border-t border-[var(--border)]">
          {Array.from({ length: COL_COUNT }).map((__, j) => (
            <td key={j} className="px-4 py-3">
              <SkeletonCell />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

function MomentRow({
  moment: m,
  expanded,
  onToggle,
  copied,
  onCopy,
}: {
  moment: DashboardMoment;
  expanded: boolean;
  onToggle: () => void;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <>
      <tr className="border-t border-[var(--border)] hover:bg-white/[0.02]">
        <td
          className="px-4 py-3 whitespace-nowrap text-[var(--muted)]"
          title={new Date(m.timestamp).toLocaleString()}
        >
          {formatRelativeTime(m.timestamp)}
        </td>
        <td className="px-4 py-3 text-[var(--text)] max-w-md">{m.question}</td>
        <td
          className="px-4 py-3 tabular-nums text-[var(--muted)]"
          title={`${m.questionMetrics.charCount} characters`}
        >
          {m.questionMetrics.wordCount}
        </td>
        <td className="px-4 py-3 tabular-nums text-[var(--muted)] whitespace-nowrap">
          {formatLatencyMs(m.latencyMs)}
        </td>
        <td className="px-4 py-3 font-mono text-xs text-[var(--muted)] max-w-sm">
          {!expanded && <span>{truncateSql(m.sql)}</span>}
          <button
            type="button"
            onClick={onToggle}
            className="ml-2 text-[var(--accent)] hover:text-[var(--accent-dim)]"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </td>
        <td
          className="px-4 py-3 tabular-nums text-[var(--muted)]"
          title={complexityTooltip(m)}
        >
          {m.sqlComplexity.score}
        </td>
        <td className="px-4 py-3">
          {m.model && (
            <span className="inline-block px-2 py-0.5 rounded border border-[var(--border)] text-xs text-[var(--accent)]">
              {m.model}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-[var(--muted)]">
          {m.tokenCount ?? "—"}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-[var(--border)] bg-black/20">
          <td colSpan={COL_COUNT} className="px-4 py-3 space-y-3">
            <p className="text-xs text-[var(--muted)]">
              SQL complexity: {m.sqlComplexity.cteCount} CTE
              {m.sqlComplexity.cteCount === 1 ? "" : "s"},{" "}
              {m.sqlComplexity.joinCount} JOIN
              {m.sqlComplexity.joinCount === 1 ? "" : "s"},{" "}
              {m.sqlComplexity.tableCount} table
              {m.sqlComplexity.tableCount === 1 ? "" : "s"},{" "}
              {m.sqlComplexity.charLength.toLocaleString()} chars (score{" "}
              {m.sqlComplexity.score})
            </p>
            <ExpandedSqlToolbar copied={copied} onCopy={onCopy} />
            <pre className="text-xs font-mono text-[var(--text)] whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
              {m.sql}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

function complexityTooltip(m: DashboardMoment): string {
  const c = m.sqlComplexity;
  return `${c.cteCount} CTEs, ${c.joinCount} JOINs, ${c.tableCount} tables, ${c.charLength} chars`;
}

function ExpandedSqlToolbar({
  copied,
  onCopy,
}: {
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex justify-end mb-2">
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

export function MomentsTable({
  moments,
  loading,
  error,
  onRefresh,
  search,
  onSearchChange,
  offset,
  total,
  pageSize,
  onPageChange,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return moments;
    return moments.filter((m) => m.question.toLowerCase().includes(q));
  }, [moments, search]);

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
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
        <input
          type="search"
          placeholder="Search questions…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 min-w-[12rem] px-3 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
        />
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

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase tracking-wide text-[var(--muted)] bg-black/20">
            <tr>
              <th className="px-4 py-3 font-medium">Timestamp</th>
              <th className="px-4 py-3 font-medium">Question</th>
              <th className="px-4 py-3 font-medium">Words</th>
              <th className="px-4 py-3 font-medium">Latency</th>
              <th className="px-4 py-3 font-medium">SQL</th>
              <th className="px-4 py-3 font-medium" title="Complexity score">
                Cplx
              </th>
              <th className="px-4 py-3 font-medium">Model</th>
              <th className="px-4 py-3 font-medium text-right">Tokens</th>
            </tr>
          </thead>
          {loading ? (
            <SkeletonRows />
          ) : filtered.length === 0 ? (
            <tbody>
              <tr>
                <td
                  colSpan={COL_COUNT}
                  className="px-4 py-12 text-center text-[var(--muted)]"
                >
                  {search.trim()
                    ? "No queries match your search."
                    : "No query pairs yet. Run a question from Home with USE_P8K8 enabled. Latency appears after new queries (stored locally)."}
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {filtered.map((m) => {
                const expanded = expandedId === m.id;
                return (
                  <MomentRow
                    key={m.id}
                    moment={m}
                    expanded={expanded}
                    onToggle={() =>
                      setExpandedId(expanded ? null : m.id)
                    }
                    copied={copiedId === m.id}
                    onCopy={() => copySql(m.id, m.sql)}
                  />
                );
              })}
            </tbody>
          )}
        </table>
      </div>

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
