"use client";

import { useCallback, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { SqlDisplay } from "@/components/SqlDisplay";
import { useTriviaQuestion } from "@/lib/hooks/useTriviaQuestion";
import { useTriviaScore } from "@/lib/hooks/useTriviaScore";

const LABELS = ["A", "B", "C", "D"] as const;

export function TriviaClient() {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const {
    correct: correctCount,
    answered: answeredCount,
    bestStreak,
    currentStreak,
    accuracy,
    recordAnswer,
    reset: resetScore,
  } = useTriviaScore();

  const {
    current: data,
    loading,
    advancing,
    error,
    prefetchReady,
    advance,
    retry,
  } = useTriviaQuestion();

  const loadQuestion = useCallback(() => {
    setSelectedIndex(null);
    void advance();
  }, [advance]);

  const handleSelect = (index: number) => {
    if (selectedIndex !== null || !data) return;
    setSelectedIndex(index);
    recordAnswer(index === data.correctIndex);
  };

  const answered = selectedIndex !== null;
  const isCorrect =
    answered && data != null && selectedIndex === data.correctIndex;
  const showSkeleton = !data && (loading || advancing);

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <AppNav />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <TriviaPageHeader />
        <div className="text-right shrink-0 space-y-1">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Score
          </p>
          <p className="text-2xl font-semibold tabular-nums text-[var(--accent)]">
            {correctCount}{" "}
            <span className="text-base font-normal text-[var(--muted)]">
              / {answeredCount}
            </span>
          </p>
          <p className="text-xs text-[var(--muted)]">
            {accuracy != null
              ? `${Math.round(accuracy * 100)}% accuracy`
              : "correct"}
            {currentStreak > 0 && (
              <span className="text-[var(--accent)]">
                {" "}
                · streak {currentStreak}
              </span>
            )}
          </p>
          {bestStreak > 0 && (
            <p className="text-xs text-[var(--muted)]">
              Best streak: {bestStreak}
            </p>
          )}
          {answeredCount > 0 && (
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Reset your trivia score? This cannot be undone."
                  )
                ) {
                  resetScore();
                }
              }}
              className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline"
            >
              Reset score
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-4 py-3 text-sm text-[var(--error)]">
          {error}
          <button
            type="button"
            onClick={() => void retry()}
            className="ml-3 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {showSkeleton && (
        <TriviaSkeleton message={advancing ? "Loading next question…" : undefined} />
      )}

      {data && (
        <div key={data.question} className="space-y-6">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6">
            <p className="text-lg font-medium leading-relaxed text-[var(--text)]">
              {data.question}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.options.map((option, index) => {
              const label = LABELS[index];
              let style =
                "border-[var(--border)] bg-[var(--panel)] hover:border-[var(--accent-dim)]";
              if (answered) {
                if (index === data.correctIndex) {
                  style =
                    "border-emerald-500/60 bg-emerald-500/10 text-[var(--text)]";
                } else if (index === selectedIndex) {
                  style =
                    "border-[var(--error)]/60 bg-[var(--error)]/10 text-[var(--text)]";
                } else {
                  style =
                    "border-[var(--border)] bg-[var(--panel)] opacity-60";
                }
              }

              return (
                <button
                  key={`${label}-${option}`}
                  type="button"
                  disabled={answered}
                  onClick={() => handleSelect(index)}
                  className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors disabled:cursor-default ${style}`}
                >
                  <span className="font-semibold text-[var(--accent)] shrink-0">
                    {label}
                  </span>
                  <span>{option}</span>
                </button>
              );
            })}
          </div>

          {answered && (
            <div className="space-y-4">
              <div
                className={`rounded-lg border px-4 py-3 text-sm ${
                  isCorrect
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-[var(--error)]/40 bg-[var(--error)]/10 text-[var(--error)]"
                }`}
              >
                {isCorrect
                  ? "Correct!"
                  : `Not quite — the answer is ${LABELS[data.correctIndex]}: ${data.options[data.correctIndex]}`}
              </div>

              <p className="text-sm text-[var(--muted)] leading-relaxed">
                {data.explanation}
              </p>

              <SqlDisplay sql={data.sql} defaultCollapsed={false} />

              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 overflow-hidden">
                {data.proof && (
                  <div className="px-4 py-3 border-b border-emerald-500/20">
                    <p className="text-xs uppercase tracking-wide text-emerald-400/90 mb-1">
                      Athena proof
                    </p>
                    <p className="text-sm text-[var(--text)] leading-relaxed">
                      {data.proof.summary}
                    </p>
                  </div>
                )}
                <div className="px-4 py-2 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2 bg-[var(--panel)]">
                  <span className="text-xs text-[var(--muted)]">
                    {data.proof ? (
                      <>
                        #1 row (highest value) → answer{" "}
                        <span className="text-[var(--accent)] font-medium">
                          {data.proof.correctLabel}
                        </span>
                      </>
                    ) : (
                      "Query results"
                    )}
                  </span>
                  <span className="text-xs text-[var(--muted)] tabular-nums">
                    {data.results.rows.length} row
                    {data.results.rows.length === 1 ? "" : "s"} ·{" "}
                    {(data.scannedBytes / 1e6).toFixed(2)} MB scanned ·{" "}
                    {data.runtimeMs} ms
                  </span>
                </div>
                <TriviaResultTable
                  columns={data.results.columns}
                  rows={data.results.rows}
                  highlightMatches={data.proof?.matches}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={loadQuestion}
                  disabled={advancing}
                  className="px-6 py-2.5 rounded-md bg-[var(--accent)] text-black text-sm font-medium hover:bg-[var(--accent-dim)] disabled:opacity-40"
                >
                  {advancing ? "Loading…" : "Next Question"}
                </button>
                {prefetchReady && !advancing && (
                  <span className="text-xs text-[var(--accent)]">
                    Next question ready
                  </span>
                )}
              </div>
            </div>
          )}

          {!answered && (
            <p className="text-xs text-center text-[var(--muted)]">
              Pick an answer — every question is verified against live Athena data.
            </p>
          )}
        </div>
      )}
    </main>
  );
}

function TriviaPageHeader() {
  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold text-[var(--text)]">
        NYC Data Trivia
      </h1>
      <p className="text-sm text-[var(--muted)]">
        Pub-quiz questions backed by real Athena queries
      </p>
    </div>
  );
}

function TriviaSkeleton({ message }: { message?: string }) {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-24 rounded-lg bg-[var(--panel)] border border-[var(--border)]" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 rounded-lg bg-[var(--panel)] border border-[var(--border)]"
          />
        ))}
      </div>
      <p className="text-center text-sm text-[var(--muted)]">
        {message ??
          "Generating question & running Athena (first load may take ~15–30s)…"}
      </p>
    </div>
  );
}

function TriviaResultTable({
  columns,
  rows,
  highlightMatches = [],
}: {
  columns: string[];
  rows: Record<string, string | null>[];
  highlightMatches?: { rowIndex: number; column: string }[];
}) {
  const isHighlighted = (rowIndex: number, column: string) =>
    highlightMatches.some(
      (m) => m.rowIndex === rowIndex && m.column === column
    );
  const isProofRow = (rowIndex: number) =>
    highlightMatches.some((m) => m.rowIndex === rowIndex);

  if (columns.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-[var(--muted)]">No columns</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
            {columns.map((col) => (
              <th key={col} className="px-4 py-2 font-medium whitespace-nowrap">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={`border-b border-[var(--border)] last:border-0 ${
                isProofRow(i) ? "bg-emerald-500/10" : ""
              }`}
            >
              {columns.map((col) => (
                <td
                  key={col}
                  className={`px-4 py-2 whitespace-nowrap ${
                    isHighlighted(i, col)
                      ? "font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/40"
                      : "tabular-nums"
                  }`}
                >
                  {row[col] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
