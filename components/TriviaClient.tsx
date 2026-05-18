"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AppNav } from "@/components/AppNav";
import { SqlDisplay } from "@/components/SqlDisplay";

type TriviaResponse = {
  question: string;
  options: string[];
  correctIndex: number;
  sql: string;
  explanation: string;
  model: string;
  results: {
    columns: string[];
    rows: Record<string, string | null>[];
  };
  scannedBytes: number;
  runtimeMs: number;
};

type ErrorResponse = {
  error: string;
  detail?: string;
  sql?: string;
};

const LABELS = ["A", "B", "C", "D"] as const;

export function TriviaClient() {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);

  const questionMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/trivia/question", { method: "POST" });
      const data = (await res.json()) as TriviaResponse | ErrorResponse;
      if (!res.ok) {
        const err = data as ErrorResponse;
        throw new Error(err.detail ?? err.error ?? "Failed to load question");
      }
      return data as TriviaResponse;
    },
    onMutate: () => {
      setSelectedIndex(null);
    },
  });

  const loadQuestion = useCallback(() => {
    questionMutation.mutate();
  }, [questionMutation]);

  useEffect(() => {
    questionMutation.mutate();
    // Initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = (index: number) => {
    if (selectedIndex !== null || !questionMutation.data) return;
    setSelectedIndex(index);
    setAnsweredCount((n) => n + 1);
    if (index === questionMutation.data.correctIndex) {
      setCorrectCount((n) => n + 1);
    }
  };

  const data = questionMutation.data;
  const answered = selectedIndex !== null;
  const isCorrect =
    answered && data != null && selectedIndex === data.correctIndex;

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <AppNav />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <TriviaPageHeader />
        <div className="text-right shrink-0">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Score
          </p>
          <p className="text-2xl font-semibold tabular-nums text-[var(--accent)]">
            {correctCount}{" "}
            <span className="text-base font-normal text-[var(--muted)]">
              / {answeredCount}
            </span>
          </p>
          <p className="text-xs text-[var(--muted)]">correct</p>
        </div>
      </header>

      {questionMutation.isError && (
        <div className="rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-4 py-3 text-sm text-[var(--error)]">
          {(questionMutation.error as Error).message}
          <button
            type="button"
            onClick={loadQuestion}
            className="ml-3 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {questionMutation.isPending && <TriviaSkeleton />}

      {data && !questionMutation.isPending && (
        <div className="space-y-6">
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

              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
                <div className="px-4 py-2 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                    Athena proof
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
                />
              </div>

              <button
                type="button"
                onClick={loadQuestion}
                disabled={questionMutation.isPending}
                className="w-full sm:w-auto px-6 py-2.5 rounded-md bg-[var(--accent)] text-black text-sm font-medium hover:bg-[var(--accent-dim)] disabled:opacity-40"
              >
                Next Question
              </button>
            </div>
          )}

          {!answered && (
            <p className="text-xs text-center text-[var(--muted)]">
              Pick an answer — every question is verified against live Athena
              data.
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

function TriviaSkeleton() {
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
        Generating question and running Athena…
      </p>
    </div>
  );
}

function TriviaResultTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, string | null>[];
}) {
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
              className="border-b border-[var(--border)] last:border-0"
            >
              {columns.map((col) => (
                <td
                  key={col}
                  className="px-4 py-2 whitespace-nowrap tabular-nums"
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
