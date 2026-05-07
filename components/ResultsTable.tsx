"use client";

type Props = {
  columns: string[];
  rows: Record<string, string | null>[];
  scannedBytes: number;
  runtimeMs: number;
};

export function ResultsTable({ columns, rows, scannedBytes, runtimeMs }: Props) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]">
      <div className="flex items-center justify-between p-3 border-b border-[var(--border)] text-xs text-[var(--muted)]">
        <span>{rows.length} rows</span>
        <span>
          {formatBytes(scannedBytes)} scanned · {(runtimeMs / 1000).toFixed(1)}s
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  className="text-left px-3 py-2 font-mono text-xs text-[var(--muted)] border-b border-[var(--border)] sticky top-0 bg-[var(--panel)]"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-[var(--border)] hover:bg-black/20"
              >
                {columns.map((c) => (
                  <td key={c} className="px-3 py-2 font-mono text-xs">
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
