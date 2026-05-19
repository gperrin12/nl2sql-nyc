import {
  DATA_CATALOG,
  DATA_CATALOG_SUPPORTING,
} from "@/lib/data-catalog";

export function DataCatalogOverview() {
  return (
    <section className="space-y-4" aria-labelledby="data-catalog-heading">
      <h2
        id="data-catalog-heading"
        className="text-sm font-medium text-[var(--text)]"
      >
        Data in this warehouse
      </h2>
      <p className="text-xs text-[var(--muted)] -mt-2">
        Ask questions in plain English; SQL runs on these Athena tables.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {DATA_CATALOG.map((entry) => (
          <article
            key={entry.id}
            className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-2.5"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-sm font-medium text-[var(--text)]">
                {entry.title}
              </h3>
              <span className="shrink-0 rounded border border-[var(--accent-dim)]/50 bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-[var(--accent)]">
                {entry.tag}
              </span>
            </div>
            <p className="text-xs font-mono text-[var(--muted)]">{entry.table}</p>
            <p className="text-sm text-[var(--text)] leading-relaxed">
              {entry.summary}
            </p>
            <p className="text-xs text-[var(--accent)]/90">{entry.coverage}</p>
            <ul className="text-xs text-[var(--muted)] space-y-1 list-disc list-inside">
              {entry.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
            {entry.relatedTables && entry.relatedTables.length > 0 && (
              <p className="text-[10px] text-[var(--muted)] pt-0.5">
                Often joined with{" "}
                <span className="font-mono text-[var(--text)]/80">
                  {entry.relatedTables.join(", ")}
                </span>
              </p>
            )}
          </article>
        ))}
      </div>

      <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--panel)]/50 px-4 py-3 space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
          Supporting tables
        </p>
        <ul className="text-xs text-[var(--muted)] space-y-1.5">
          {DATA_CATALOG_SUPPORTING.map(({ table, role }) => (
            <li key={table}>
              <span className="font-mono text-[var(--text)]/90">{table}</span>
              <span className="text-[var(--muted)]"> — {role}</span>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-[var(--muted)] leading-relaxed">
          Large fact tables are partitioned by{" "}
          <span className="font-mono">year</span> and{" "}
          <span className="font-mono">month</span> (STRING literals, e.g.{" "}
          <span className="font-mono">year = &apos;2024&apos;</span>). Always
          filter by time when you can — unfiltered scans are slow and costly.
        </p>
      </div>
    </section>
  );
}
