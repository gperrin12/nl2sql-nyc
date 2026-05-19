"use client";

import { useState } from "react";
import {
  DATA_CATALOG,
  DATA_CATALOG_SUPPORTING,
  type DataCatalogEntry,
} from "@/lib/data-catalog";

export function DataCatalogOverview() {
  const [open, setOpen] = useState(false);

  return (
    <section
      className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden"
      aria-labelledby="data-catalog-toggle"
    >
      <button
        id="data-catalog-toggle"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <span className="text-sm font-medium text-[var(--text)]">
          Data catalog
        </span>
        <span
          className="text-[var(--muted)] text-xs shrink-0 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          aria-hidden
        >
          ▼
        </span>
      </button>

      {open && (
        <div
          id="data-catalog-panel"
          className="border-t border-[var(--border)] px-4 pb-4 pt-3 space-y-4"
        >
          <p className="text-xs text-[var(--muted)]">
            Ask questions in plain English; SQL runs on these Athena tables.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {DATA_CATALOG.map((entry) => (
              <CatalogCard key={entry.id} entry={entry} />
            ))}
          </div>

          <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg)]/50 px-4 py-3 space-y-2">
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
        </div>
      )}
    </section>
  );
}

function CatalogCard({ entry }: { entry: DataCatalogEntry }) {
  return (
    <article className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4 space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-[var(--text)]">{entry.title}</h3>
        <span className="shrink-0 rounded border border-[var(--accent-dim)]/50 bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-[var(--accent)]">
          {entry.tag}
        </span>
      </div>
      <p className="text-xs font-mono text-[var(--muted)]">{entry.table}</p>
      <p className="text-sm text-[var(--text)] leading-relaxed">{entry.summary}</p>
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
  );
}
