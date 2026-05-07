"use client";

import { useState } from "react";

export function SqlDisplay({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
          Generated SQL
        </span>
        <button
          onClick={copy}
          className="text-xs text-[var(--accent)] hover:text-[var(--accent-dim)]"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto text-sm font-mono leading-relaxed text-[var(--text)] whitespace-pre-wrap">
        {sql}
      </pre>
    </div>
  );
}
