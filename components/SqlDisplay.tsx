"use client";

import { useEffect, useState } from "react";

type Props = {
  sql: string;
  /** Start collapsed so map/results stay above the fold for spatial questions */
  defaultCollapsed?: boolean;
};

export function SqlDisplay({ sql, defaultCollapsed = false }: Props) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(!defaultCollapsed);

  useEffect(() => {
    setExpanded(!defaultCollapsed);
  }, [sql, defaultCollapsed]);

  const copy = async () => {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
          Generated SQL
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
          <button
            type="button"
            onClick={copy}
            className="text-xs text-[var(--accent)] hover:text-[var(--accent-dim)]"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
      {expanded ? (
        <pre className="overflow-x-auto text-sm font-mono leading-relaxed text-[var(--text)] whitespace-pre-wrap">
          {sql}
        </pre>
      ) : (
        <p className="text-xs font-mono text-[var(--muted)] truncate" title={sql}>
          {sql.slice(0, 140)}
          {sql.length > 140 ? "…" : ""}
        </p>
      )}
    </div>
  );
}
