"use client";

import { RESULT_TABLE_DISPLAY_ROWS } from "@/lib/athenaLimits";

type Props = {
  columns: string[];
  rows: Record<string, string | null>[];
  scannedBytes: number;
  runtimeMs: number;
};

export function ResultsTable({ columns, rows, scannedBytes, runtimeMs }: Props) {
  const total = rows.length;
  const displayRows = rows.slice(0, RESULT_TABLE_DISPLAY_ROWS);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
      <div className="flex items-center justify-between p-3 border-b border-[var(--border)] text-xs text-[var(--muted)]">
        <span>
          Showing {displayRows.length} of {total} row{total === 1 ? "" : "s"}
          {total >= RESULT_TABLE_DISPLAY_ROWS ? ` (table preview)` : ""}
        </span>
        <span>
          {formatBytes(scannedBytes)} scanned · {(runtimeMs / 1000).toFixed(1)}s
        </span>
      </div>
      <div className="max-h-[min(360px,42vh)] overflow-auto overscroll-contain rounded-b-lg">
        <table className="w-full text-sm min-w-max">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  className="text-left px-3 py-2 font-mono text-xs text-[var(--muted)] border-b border-[var(--border)] sticky top-0 bg-[var(--panel)] z-10 shadow-[0_1px_0_0_var(--border)]"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-[var(--border)] hover:bg-black/20"
              >
                {columns.map((c) => (
                  <td
                    key={c}
                    className="px-3 py-2 font-mono text-xs align-top whitespace-nowrap"
                  >
                    {row[c] ?? <span className="text-[var(--muted)]">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
