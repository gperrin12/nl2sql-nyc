"use client";

import { useMemo, useState } from "react";
import { SqlDisplay } from "@/components/SqlDisplay";
import { ResultsPanel } from "@/components/ResultsPanel";

interface HybridChunk {
  content: string;
  source: string;
  date: string;
  section: string;
  page: number | null;
  similarity: number;
  chunkId: string;
}

interface HybridResponse {
  answer: string;
  sqlResult: {
    sql: string;
    rows: Record<string, unknown>[];
    rowCount: number;
    tableName: string;
    timestamp: string;
    runtimeMs: number;
  } | null;
  ragResult: {
    answer: string;
    chunks: HybridChunk[];
  } | null;
  partialFailure?: {
    side: "sql" | "rag";
    reason: string;
  };
}

const EXAMPLES = [
  "Did 311 noise complaints spike in Bushwick after the 2022 rezoning, and what were residents saying about it?",
  "How does the NYPD collision rate in Brooklyn compare to what the Mayor's Management Report says the target was?",
  "What does the MMR say about DSNY missed collections, and how many 311 sanitation complaints were filed in 2024?",
  "Were taxi trip volumes in Manhattan consistent with transit ridership trends described in government reports?",
];

function parseApiError(text: string): string {
  try {
    const data = JSON.parse(text) as { error?: string };
    return data.error ?? text;
  } catch {
    return text;
  }
}

function formatSource(source: string): string {
  if (source.startsWith("http")) {
    try {
      const path = new URL(source).pathname;
      const file = path.split("/").pop() ?? source;
      return file.replace(/\.pdf$/i, "").replace(/_/g, " ");
    } catch {
      return source;
    }
  }
  return source;
}

function rowsToAthenaShape(
  rows: Record<string, unknown>[]
): Record<string, string | null>[] {
  return rows.map((row) => {
    const out: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = value == null ? null : String(value);
    }
    return out;
  });
}

export function HybridTab() {
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<HybridResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sqlColumns = useMemo(() => {
    const rows = response?.sqlResult?.rows;
    if (!rows?.length) return [];
    return Object.keys(rows[0]);
  }, [response?.sqlResult?.rows]);

  const sqlRows = useMemo(() => {
    const rows = response?.sqlResult?.rows;
    if (!rows?.length) return [];
    return rowsToAthenaShape(rows);
  }, [response?.sqlResult?.rows]);

  async function handleSubmit(questionText: string) {
    const trimmed = questionText.trim();
    if (!trimmed || isLoading) return;

    setQuestion(trimmed);
    setIsLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch("/api/hybrid/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      if (!res.ok) throw new Error(parseApiError(await res.text()));
      const data: HybridResponse = await res.json();
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--muted)]">
        Combines Athena SQL with government documents into one cited answer. Runs
        both retrievals in parallel — may take up to two minutes.
      </p>

      <div className="space-y-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2">
          <textarea
            id="hybrid-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                void handleSubmit(question);
              }
            }}
            rows={3}
            placeholder="Ask a question that needs both numbers and document context — trends plus policy, data plus community response..."
            className="w-full bg-transparent outline-none resize-none text-base p-2 text-[var(--text)]"
            disabled={isLoading}
          />
          <div className="flex justify-between items-center px-2 pb-1">
            <span className="text-xs text-[var(--muted)]">
              Cmd/Ctrl + Enter to run
            </span>
            <button
              type="button"
              onClick={() => void handleSubmit(question)}
              disabled={isLoading || !question.trim()}
              className="px-4 py-1.5 rounded-md bg-[var(--accent)] text-black text-sm font-medium hover:bg-[var(--accent-dim)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? "Running SQL + documents…" : "Run hybrid"}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setQuestion(ex)}
              disabled={isLoading}
              className="text-xs px-3 py-1 rounded-full border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent-dim)] disabled:opacity-40"
            >
              {ex.length > 72 ? `${ex.slice(0, 72)}…` : ex}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <p className="text-sm text-[var(--foreground)]">
            Running SQL and document retrieval in parallel, then synthesizing…
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--error)] bg-red-950/20 p-4">
          <p className="text-sm font-medium text-[var(--error)]">Hybrid query failed</p>
          <p className="text-xs font-mono whitespace-pre-wrap mt-1 text-[var(--text)]">
            {error}
          </p>
        </div>
      )}

      {response && (
        <div className="space-y-4">
          {response.partialFailure && (
            <div className="rounded-lg border border-amber-600/50 bg-amber-950/20 p-4">
              <p className="text-sm font-medium text-amber-200">
                Partial failure — {response.partialFailure.side.toUpperCase()} side
                unavailable
              </p>
              <p className="text-xs font-mono whitespace-pre-wrap mt-1 text-[var(--muted)]">
                {response.partialFailure.reason}
              </p>
            </div>
          )}

          <div className="rounded-lg border border-[var(--border)] border-l-4 border-l-[var(--accent)] bg-[var(--panel)] p-4">
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] mb-1">
              Synthesized answer
            </p>
            <p className="text-sm text-[var(--text)] leading-relaxed whitespace-pre-wrap">
              {response.answer}
            </p>
          </div>

          {response.sqlResult && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)] px-1">
                Structured data ({response.sqlResult.rowCount} rows ·{" "}
                {response.sqlResult.runtimeMs}ms)
              </p>
              <SqlDisplay sql={response.sqlResult.sql} defaultCollapsed />
              {sqlColumns.length > 0 && (
                <ResultsPanel
                  mapResetKey={response.sqlResult.timestamp}
                  columns={sqlColumns}
                  rows={sqlRows}
                  scannedBytes={0}
                  runtimeMs={response.sqlResult.runtimeMs}
                />
              )}
            </div>
          )}

          {response.ragResult && response.ragResult.chunks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)] px-1">
                Document sources ({response.ragResult.chunks.length})
              </p>
              {response.ragResult.chunks.map((chunk, i) => (
                <div
                  key={chunk.chunkId}
                  className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-xs font-medium text-[var(--foreground)] truncate">
                        [{i + 1}] {formatSource(chunk.source)}
                      </p>
                      {chunk.date !== "unknown" && (
                        <p className="text-xs text-[var(--muted)]">{chunk.date}</p>
                      )}
                      {chunk.section && (
                        <p className="text-xs text-[var(--muted)]">{chunk.section}</p>
                      )}
                      {chunk.page != null && (
                        <p className="text-xs text-[var(--muted)]">p. {chunk.page}</p>
                      )}
                    </div>
                    <span
                      className="shrink-0 text-xs font-mono text-[var(--accent)]"
                      title="Cosine similarity"
                    >
                      {(Number(chunk.similarity) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-xs text-[var(--muted)] leading-relaxed line-clamp-4 font-mono whitespace-pre-wrap">
                    {chunk.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
