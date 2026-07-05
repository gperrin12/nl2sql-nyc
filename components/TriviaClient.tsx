"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { CrtWelcome } from "@/components/CrtWelcome";
import { SqlDisplay } from "@/components/SqlDisplay";
import { TriviaGameOver } from "@/components/trivia/TriviaGameOver";
import { TriviaNamePicker } from "@/components/trivia/TriviaNamePicker";
import { TriviaLeaderboard } from "@/components/trivia/TriviaLeaderboard";
import { useTriviaHiScores } from "@/lib/hooks/useTriviaHiScores";
import { useTriviaQuestion } from "@/lib/hooks/useTriviaQuestion";
import { useTriviaScore } from "@/lib/hooks/useTriviaScore";
import {
  DEFAULT_TRIVIA_DECK,
  TRIVIA_DECK_LABELS,
  TRIVIA_DECK_OPTIONS,
  type TriviaDeck,
} from "@/lib/trivia-categories";
import { TRIVIA_SESSION_LENGTH } from "@/lib/trivia-hiscores";
import {
  constraintsFromSession,
  createTriviaSessionState,
  recordTriviaQuestionShown,
} from "@/lib/trivia-session";

const LABELS = ["A", "B", "C", "D"] as const;

type GamePhase = "playing" | "gameover" | "name" | "leaderboard";

export function TriviaClient() {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [phase, setPhase] = useState<GamePhase>("playing");
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionAnswered, setSessionAnswered] = useState(0);
  const [newEntryId, setNewEntryId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [deck, setDeck] = useState<TriviaDeck>(DEFAULT_TRIVIA_DECK);
  const sessionRef = useRef(createTriviaSessionState(DEFAULT_TRIVIA_DECK));

  const resetSession = useCallback((nextDeck: TriviaDeck) => {
    sessionRef.current = createTriviaSessionState(nextDeck);
    setSessionKey((k) => k + 1);
    setPhase("playing");
    setSessionCorrect(0);
    setSessionAnswered(0);
    setNewEntryId(null);
    setSelectedIndex(null);
  }, []);

  const handleDeckChange = useCallback(
    (nextDeck: TriviaDeck) => {
      if (nextDeck === deck) return;
      setDeck(nextDeck);
      resetSession(nextDeck);
    },
    [deck, resetSession]
  );

  const getSessionConstraints = useCallback(
    () => constraintsFromSession(sessionRef.current),
    []
  );

  const onQuestionLoaded = useCallback(
    (meta: { question: string; categoryId?: string }) => {
      sessionRef.current = recordTriviaQuestionShown(
        sessionRef.current,
        meta.question,
        meta.categoryId
      );
    },
    []
  );

  const { bestStreak, currentStreak, recordAnswer } = useTriviaScore();

  const {
    board,
    loading: hiScoresLoading,
    submitting: hiScoresSubmitting,
    error: hiScoresError,
    qualifies,
    submitScore,
    refresh: refreshHiScores,
  } = useTriviaHiScores({ pollWhileLeaderboard: phase === "leaderboard" });

  const {
    current: data,
    loading,
    advancing,
    error,
    errorSql,
    prefetchReady,
    advance,
    retry,
  } = useTriviaQuestion({
    sessionKey,
    getSessionConstraints,
    onQuestionLoaded,
  });

  const loadQuestion = useCallback(() => {
    setSelectedIndex(null);
    void advance();
  }, [advance]);

  const handleSelect = (index: number) => {
    if (selectedIndex !== null || !data || phase !== "playing") return;
    const correct = index === data.correctIndex;
    setSelectedIndex(index);
    recordAnswer(correct);
    setSessionCorrect((c) => c + (correct ? 1 : 0));
    setSessionAnswered((a) => a + 1);
  };

  const finishGame = () => setPhase("gameover");

  const handleGameOverContinue = () => {
    if (qualifies(sessionCorrect)) {
      setPhase("name");
    } else {
      setNewEntryId(null);
      setPhase("leaderboard");
    }
  };

  const handleNameComplete = async (name: string) => {
    try {
      const entry = await submitScore(name, sessionCorrect);
      setNewEntryId(entry.id);
      setPhase("leaderboard");
    } catch {
      // error surfaced via hiScoresError
    }
  };

  const handlePlayAgain = () => {
    resetSession(deck);
  };

  const viewLeaderboard = () => {
    setNewEntryId(null);
    setPhase("leaderboard");
    void refreshHiScores();
  };

  const answered = selectedIndex !== null;
  const isCorrect =
    answered && data != null && selectedIndex === data.correctIndex;
  const showSkeleton = phase === "playing" && !data && (loading || advancing);
  const questionNumber = Math.min(sessionAnswered + 1, TRIVIA_SESSION_LENGTH);
  const isLastQuestion =
    sessionAnswered === TRIVIA_SESSION_LENGTH && answered;
  const showQuestion =
    sessionAnswered < TRIVIA_SESSION_LENGTH || isLastQuestion;

  return (
    <main className="crt-root max-w-3xl mx-auto p-6 space-y-6">
      <AppNav />

      <CrtWelcome productName="NL2SQL NYC Trivia">
        <p className="text-[var(--muted)] text-sm">
          nyc civic data trivia :: taxi · 311 · crashes · census · subway
        </p>
      </CrtWelcome>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TriviaPageHeader deck={deck} onDeckChange={handleDeckChange} />
        <Link
          href="/trivia/live"
          className="rounded-md border-2 border-[var(--accent)] px-4 py-2 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)] hover:text-black transition-colors font-mono uppercase tracking-wide"
        >
          ▶ Play with friends
        </Link>
      </div>

      {phase === "gameover" && (
        <TriviaGameOver
          score={sessionCorrect}
          total={TRIVIA_SESSION_LENGTH}
          onContinue={handleGameOverContinue}
        />
      )}

      {phase === "name" && (
        <>
          <TriviaNamePicker
            score={sessionCorrect}
            total={TRIVIA_SESSION_LENGTH}
            disabled={hiScoresSubmitting}
            onComplete={(name) => void handleNameComplete(name)}
            onSkip={() => void handleNameComplete("GUEST")}
          />
          {hiScoresError && (
            <p className="text-center text-sm text-[var(--error)] font-mono">
              {hiScoresError}
            </p>
          )}
        </>
      )}

      {phase === "leaderboard" && (
        <TriviaLeaderboard
          entries={board}
          loading={hiScoresLoading}
          error={hiScoresError}
          highlightId={newEntryId}
          sessionScore={
            sessionAnswered >= TRIVIA_SESSION_LENGTH ? sessionCorrect : undefined
          }
          onRefresh={() => void refreshHiScores()}
          onPlayAgain={
            sessionAnswered >= TRIVIA_SESSION_LENGTH ? handlePlayAgain : undefined
          }
          onBack={
            sessionAnswered < TRIVIA_SESSION_LENGTH
              ? () => setPhase("playing")
              : undefined
          }
        />
      )}

      {phase === "playing" && error && (
        <div className="space-y-3">
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
          {errorSql && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] px-1">
                Last attempted SQL
              </p>
              <SqlDisplay sql={errorSql} defaultCollapsed={false} />
            </div>
          )}
        </div>
      )}

      {phase === "playing" && showSkeleton && (
        <>
          <TriviaSkeleton message={advancing ? "Loading next question…" : undefined} />
          <TriviaSessionStats
            sessionCorrect={sessionCorrect}
            sessionAnswered={sessionAnswered}
            questionNumber={questionNumber}
            currentStreak={currentStreak}
            bestStreak={bestStreak}
            onViewLeaderboard={viewLeaderboard}
          />
        </>
      )}

      {phase === "playing" && data && showQuestion && (
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

          <TriviaSessionStats
            sessionCorrect={sessionCorrect}
            sessionAnswered={sessionAnswered}
            questionNumber={questionNumber}
            categoryLabel={data.categoryLabel}
            currentStreak={currentStreak}
            bestStreak={bestStreak}
            onViewLeaderboard={viewLeaderboard}
          />

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

              <div className="flex flex-wrap items-center gap-3">
                {isLastQuestion ? (
                  <button
                    type="button"
                    onClick={finishGame}
                    className="px-6 py-2.5 rounded-md bg-[var(--accent)] text-black text-sm font-medium hover:bg-[var(--accent-dim)] font-mono uppercase tracking-wide"
                  >
                    Finish Game
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={loadQuestion}
                    disabled={advancing}
                    className="px-6 py-2.5 rounded-md bg-[var(--accent)] text-black text-sm font-medium hover:bg-[var(--accent-dim)] disabled:opacity-40"
                  >
                    {advancing ? "Loading…" : "Next Question"}
                  </button>
                )}
                {prefetchReady && !advancing && !isLastQuestion && (
                  <span className="text-xs text-[var(--accent)]">
                    Next question ready
                  </span>
                )}
              </div>

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

              <SqlDisplay sql={data.sql} defaultCollapsed />
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

function TriviaPageHeader({
  deck,
  onDeckChange,
}: {
  deck: TriviaDeck;
  onDeckChange: (deck: TriviaDeck) => void;
}) {
  return (
    <nav className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1 w-fit">
      {TRIVIA_DECK_OPTIONS.map((option) => {
        const active = deck === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onDeckChange(option)}
            className={
              active
                ? "rounded-md bg-[var(--bg)] px-3 py-1.5 text-xs font-medium text-[var(--text)] shadow-sm"
                : "rounded-md px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)]"
            }
          >
            {TRIVIA_DECK_LABELS[option]}
          </button>
        );
      })}
    </nav>
  );
}

function TriviaSessionStats({
  sessionCorrect,
  sessionAnswered,
  questionNumber,
  categoryLabel,
  currentStreak,
  bestStreak,
  onViewLeaderboard,
}: {
  sessionCorrect: number;
  sessionAnswered: number;
  questionNumber: number;
  categoryLabel?: string;
  currentStreak: number;
  bestStreak: number;
  onViewLeaderboard: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              Session
            </p>
            <p className="text-xl font-semibold tabular-nums text-[var(--accent)] font-mono">
              {sessionCorrect}{" "}
              <span className="text-sm font-normal text-[var(--muted)]">
                / {sessionAnswered}
              </span>
            </p>
          </div>
          <p className="text-xs text-[var(--muted)] font-mono uppercase">
            Q {questionNumber} / {TRIVIA_SESSION_LENGTH}
          </p>
          {currentStreak > 0 && (
            <p className="text-xs text-[var(--muted)]">
              Streak{" "}
              <span className="text-[var(--accent)]">{currentStreak}</span>
              {bestStreak > 0 && (
                <span>
                  {" "}
                  · best {bestStreak}
                </span>
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onViewLeaderboard}
          className="text-xs text-[var(--muted)] hover:text-[var(--accent)] underline font-mono uppercase shrink-0"
        >
          High Scores
        </button>
      </div>
      {categoryLabel && (
        <p
          className="text-[10px] text-[var(--muted)] line-clamp-2"
          title={categoryLabel}
        >
          {categoryLabel}
        </p>
      )}
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

/** Format numeric cells for display; labels and integers stay as-is (max 3 decimals). */
function formatTriviaCellValue(value: string | null): string {
  if (value == null || value === "") return "—";
  const s = value.trim();
  const normalized = s.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(normalized)) return s;

  const n = Number(normalized);
  if (!Number.isFinite(n)) return s;
  if (Number.isInteger(n)) return String(n);

  const rounded = Math.round(n * 1000) / 1000;
  return rounded.toLocaleString(undefined, {
    maximumFractionDigits: 3,
    minimumFractionDigits: 0,
  });
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
                  {formatTriviaCellValue(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
