"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { CrtWelcome } from "@/components/CrtWelcome";
import { TriviaCountdown } from "@/components/trivia/TriviaCountdown";
import { TriviaRoomStandings } from "@/components/trivia/TriviaRoomStandings";
import { useTriviaRoomState } from "@/lib/hooks/useTriviaRoomState";

const LABELS = ["A", "B", "C", "D"] as const;

function readIdentity(
  code: string
): { playerId: string; nickname: string } | null {
  try {
    const raw = localStorage.getItem(`nl2sql-trivia-room-${code}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      playerId?: string;
      nickname?: string;
    };
    return parsed.playerId
      ? { playerId: parsed.playerId, nickname: parsed.nickname ?? "" }
      : null;
  } catch {
    return null;
  }
}

export default function TriviaLivePlayPage() {
  const params = useParams();
  const code = (Array.isArray(params.code) ? params.code[0] : params.code) ?? "";

  const [playerId, setPlayerId] = useState<string | undefined>(undefined);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [myChoice, setMyChoice] = useState<number | null>(null);
  const [answeredIndex, setAnsweredIndex] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const [timedQuestion, setTimedQuestion] = useState<number | null>(null);

  useEffect(() => {
    const id = readIdentity(code);
    setPlayerId(id?.playerId);
    setIdentityChecked(true);
  }, [code]);

  const { state, loading, error, refresh } = useTriviaRoomState({
    code,
    playerId,
  });

  // Reset the local pick whenever the host advances to a new question.
  useEffect(() => {
    if (!state) return;
    if (answeredIndex !== state.currentIndex) {
      setMyChoice(null);
      setSubmitError(null);
      setAnsweredIndex(null);
    }
  }, [state, answeredIndex]);

  // Clear the "time's up" lock when a new question starts.
  useEffect(() => {
    if (state && timedQuestion !== state.currentIndex) {
      setTimeUp(false);
      setTimedQuestion(state.currentIndex);
    }
  }, [state, timedQuestion]);

  // The server is the source of truth for whether/what this player answered
  // (survives refresh); fall back to the optimistic local pick.
  const chosenIndex = state?.you?.choiceIndex ?? myChoice;
  const answered = chosenIndex != null;
  const revealed =
    state != null &&
    state.answerRevealed &&
    state.revealedCorrectIndex != null;

  const submitAnswer = useCallback(
    async (choiceIndex: number) => {
      if (!state || !playerId || submitting) return;
      if (state.answerRevealed || timeUp) return;
      if (chosenIndex != null) return;

      const questionIndex = state.currentIndex;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const res = await fetch(
          `/api/trivia-room/${encodeURIComponent(code)}/answer`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerId, questionIndex, choiceIndex }),
          }
        );
        const data = (await res.json()) as { error?: string; detail?: string };
        if (!res.ok) {
          throw new Error(data.detail ?? data.error ?? "Failed to submit");
        }
        setAnsweredIndex(questionIndex);
        setMyChoice(choiceIndex);
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : "Failed to submit");
      } finally {
        setSubmitting(false);
      }
    },
    [chosenIndex, code, playerId, state, submitting, timeUp]
  );

  const correctIndex = state?.revealedCorrectIndex ?? null;
  const isCorrect = revealed && chosenIndex != null && chosenIndex === correctIndex;

  return (
    <main className="crt-root max-w-3xl mx-auto p-6 space-y-6">
      <AppNav />

      <CrtWelcome>
        <p className="text-[var(--muted)] text-sm">
          live trivia :: room {code} — answer and wait for the host to reveal
        </p>
      </CrtWelcome>

      {identityChecked && !playerId && (
        <div className="rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-4 py-3 text-sm text-[var(--error)]">
          You have not joined this room on this device.{" "}
          <Link href="/trivia/live" className="underline">
            Join a room
          </Link>
          .
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-4 py-3 text-sm text-[var(--error)]">
          {error}
        </div>
      )}

      {loading && !state && (
        <p className="text-center text-sm text-[var(--muted)] animate-pulse py-8">
          Loading room…
        </p>
      )}

      {state && state.status === "lobby" && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-8 text-center space-y-2">
          <p className="font-mono uppercase tracking-wide text-[var(--accent)]">
            Waiting for host to start…
          </p>
          <p className="text-sm text-[var(--muted)]">
            {state.players.length} player
            {state.players.length === 1 ? "" : "s"} in the lobby
          </p>
        </div>
      )}

      {state && state.status === "playing" && state.currentQuestion && (
        <div className="space-y-6">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 space-y-2">
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] font-mono">
              Question {Math.min(state.currentIndex + 1, state.totalQuestions)} /{" "}
              {state.totalQuestions}
            </p>
            <p className="text-lg font-medium leading-relaxed text-[var(--text)]">
              {state.currentQuestion.question}
            </p>
            {!revealed && (
              <TriviaCountdown
                startedAt={state.questionStartedAt}
                durationSeconds={state.durationSeconds}
                onExpire={() => {
                  setTimeUp(true);
                  void refresh();
                }}
              />
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {state.currentQuestion.choices.map((choice, index) => {
              const label = LABELS[index] ?? String(index + 1);
              let style =
                "border-[var(--border)] bg-[var(--panel)] hover:border-[var(--accent-dim)]";
              if (revealed) {
                if (index === correctIndex) {
                  style =
                    "border-emerald-500/60 bg-emerald-500/10 text-[var(--text)]";
                } else if (index === chosenIndex) {
                  style =
                    "border-[var(--error)]/60 bg-[var(--error)]/10 text-[var(--text)]";
                } else {
                  style = "border-[var(--border)] bg-[var(--panel)] opacity-60";
                }
              } else if (answered && index === chosenIndex) {
                // Locked-in pick, but not yet revealed — neutral highlight only.
                style = "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)]";
              }

              return (
                <button
                  key={`${label}-${choice}`}
                  type="button"
                  disabled={
                    answered || revealed || submitting || timeUp || !playerId
                  }
                  onClick={() => void submitAnswer(index)}
                  className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors disabled:cursor-default ${style}`}
                >
                  <span className="font-semibold text-[var(--accent)] shrink-0">
                    {label}
                  </span>
                  <span>{choice}</span>
                </button>
              );
            })}
          </div>

          {submitError && (
            <p className="text-center text-sm text-[var(--error)] font-mono">
              {submitError}
            </p>
          )}

          {revealed && (
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                isCorrect
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-[var(--error)]/40 bg-[var(--error)]/10 text-[var(--error)]"
              }`}
            >
              {chosenIndex == null
                ? `Time's up — the answer was ${
                    LABELS[correctIndex ?? 0] ?? (correctIndex ?? 0) + 1
                  }: ${state.currentQuestion.choices[correctIndex ?? 0]}`
                : isCorrect
                  ? "Correct!"
                  : `Not quite — the answer was ${
                      LABELS[correctIndex ?? 0] ?? (correctIndex ?? 0) + 1
                    }: ${state.currentQuestion.choices[correctIndex ?? 0]}`}
            </div>
          )}

          {!revealed && answered && (
            <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-3 text-sm text-[var(--accent)]">
              Answer locked in — waiting for the reveal…
            </div>
          )}

          {!revealed && !answered && timeUp && (
            <div className="rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-4 py-3 text-sm text-[var(--error)]">
              Time&apos;s up — answers are locked. Waiting for the reveal…
            </div>
          )}

          {!revealed && !answered && !timeUp && (
            <p className="text-xs text-center text-[var(--muted)]">
              Pick an answer before the timer runs out.
            </p>
          )}
        </div>
      )}

      {state && state.status === "playing" && !state.currentQuestion && (
        <p className="text-center text-sm text-[var(--muted)] animate-pulse py-8">
          Waiting for the next question…
        </p>
      )}

      {state && state.status === "finished" && (
        <TriviaRoomStandings
          players={state.players.map((p) => ({
            id: p.id,
            nickname: p.nickname,
            score: p.score,
            correctCount: p.correctCount ?? p.score,
          }))}
          totalQuestions={state.totalQuestions}
          currentPlayerId={playerId}
          isHost={false}
        />
      )}
    </main>
  );
}
