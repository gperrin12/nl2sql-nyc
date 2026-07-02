"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { CrtWelcome } from "@/components/CrtWelcome";
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

type AnswerResult = {
  questionIndex: number;
  choiceIndex: number;
  correctIndex: number;
  correct: boolean;
};

export default function TriviaLivePlayPage() {
  const params = useParams();
  const code = (Array.isArray(params.code) ? params.code[0] : params.code) ?? "";

  const [playerId, setPlayerId] = useState<string | undefined>(undefined);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [answer, setAnswer] = useState<AnswerResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const answeredIndexRef = useRef<number | null>(null);

  useEffect(() => {
    const id = readIdentity(code);
    setPlayerId(id?.playerId);
    setIdentityChecked(true);
  }, [code]);

  const { state, loading, error } = useTriviaRoomState({ code, playerId });

  // Clear the local answer whenever the host advances to a new question.
  useEffect(() => {
    if (!state) return;
    if (answeredIndexRef.current !== state.currentIndex) {
      answeredIndexRef.current = null;
      setAnswer(null);
      setSubmitError(null);
    }
  }, [state]);

  const submitAnswer = useCallback(
    async (choiceIndex: number) => {
      if (!state || !playerId || submitting) return;
      if (answer && answer.questionIndex === state.currentIndex) return;

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
        const data = (await res.json()) as {
          correct?: boolean;
          correctIndex?: number;
          error?: string;
          detail?: string;
        };
        if (!res.ok || typeof data.correctIndex !== "number") {
          throw new Error(data.detail ?? data.error ?? "Failed to submit");
        }
        answeredIndexRef.current = questionIndex;
        setAnswer({
          questionIndex,
          choiceIndex,
          correctIndex: data.correctIndex,
          correct: Boolean(data.correct),
        });
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : "Failed to submit");
      } finally {
        setSubmitting(false);
      }
    },
    [answer, code, playerId, state, submitting]
  );

  const answeredThisQuestion =
    answer != null && state != null && answer.questionIndex === state.currentIndex;

  return (
    <main className="crt-root max-w-3xl mx-auto p-6 space-y-6">
      <AppNav />

      <CrtWelcome>
        <p className="text-[var(--muted)] text-sm">
          live trivia :: room {code} — answer before the host moves on
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
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {state.currentQuestion.choices.map((choice, index) => {
              const label = LABELS[index] ?? String(index + 1);
              let style =
                "border-[var(--border)] bg-[var(--panel)] hover:border-[var(--accent-dim)]";
              if (answeredThisQuestion && answer) {
                if (index === answer.correctIndex) {
                  style =
                    "border-emerald-500/60 bg-emerald-500/10 text-[var(--text)]";
                } else if (index === answer.choiceIndex) {
                  style =
                    "border-[var(--error)]/60 bg-[var(--error)]/10 text-[var(--text)]";
                } else {
                  style = "border-[var(--border)] bg-[var(--panel)] opacity-60";
                }
              }

              return (
                <button
                  key={`${label}-${choice}`}
                  type="button"
                  disabled={answeredThisQuestion || submitting || !playerId}
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

          {answeredThisQuestion && answer && (
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                answer.correct
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-[var(--error)]/40 bg-[var(--error)]/10 text-[var(--error)]"
              }`}
            >
              {answer.correct
                ? "Correct! Waiting for the host to move on…"
                : `Not quite — the answer was ${
                    LABELS[answer.correctIndex] ?? answer.correctIndex + 1
                  }. Waiting for the host…`}
            </div>
          )}

          {!answeredThisQuestion && (
            <p className="text-xs text-center text-[var(--muted)]">
              Pick an answer before the host advances.
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
