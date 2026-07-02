"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { CrtWelcome } from "@/components/CrtWelcome";
import { TriviaCountdown } from "@/components/trivia/TriviaCountdown";
import { TriviaRoomStandings } from "@/components/trivia/TriviaRoomStandings";
import { useTriviaRoomState } from "@/lib/hooks/useTriviaRoomState";

const LABELS = ["A", "B", "C", "D"] as const;

function readIdentity(code: string): { playerId: string } | null {
  try {
    const raw = localStorage.getItem(`nl2sql-trivia-room-${code}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { playerId?: string };
    return parsed.playerId ? { playerId: parsed.playerId } : null;
  } catch {
    return null;
  }
}

export default function TriviaLiveHostPage() {
  const params = useParams();
  const router = useRouter();
  const code = (Array.isArray(params.code) ? params.code[0] : params.code) ?? "";

  const [playerId, setPlayerId] = useState<string | undefined>(undefined);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  useEffect(() => {
    const id = readIdentity(code);
    setPlayerId(id?.playerId);
    setIdentityChecked(true);
  }, [code]);

  const { state, loading, error, refresh } = useTriviaRoomState({
    code,
    playerId,
  });

  const advance = useCallback(async () => {
    if (!playerId || advancing) return;
    setAdvancing(true);
    setAdvanceError(null);
    try {
      const res = await fetch(
        `/api/trivia-room/${encodeURIComponent(code)}/advance`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId }),
        }
      );
      const data = (await res.json()) as { error?: string; detail?: string };
      if (!res.ok) {
        throw new Error(data.detail ?? data.error ?? "Failed to advance");
      }
      await refresh();
    } catch (e) {
      setAdvanceError(e instanceof Error ? e.message : "Failed to advance");
    } finally {
      setAdvancing(false);
    }
  }, [code, playerId, advancing, refresh]);

  const reveal = useCallback(async () => {
    if (!playerId || revealing) return;
    setRevealing(true);
    setAdvanceError(null);
    try {
      const res = await fetch(
        `/api/trivia-room/${encodeURIComponent(code)}/reveal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId }),
        }
      );
      const data = (await res.json()) as { error?: string; detail?: string };
      if (!res.ok) {
        throw new Error(data.detail ?? data.error ?? "Failed to reveal");
      }
      await refresh();
    } catch (e) {
      setAdvanceError(e instanceof Error ? e.message : "Failed to reveal");
    } finally {
      setRevealing(false);
    }
  }, [code, playerId, revealing, refresh]);

  return (
    <main className="crt-root max-w-3xl mx-auto p-6 space-y-6">
      <AppNav />

      <CrtWelcome>
        <p className="text-[var(--muted)] text-sm">
          hosting live trivia :: share the code below to fill your lobby
        </p>
      </CrtWelcome>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
            Room code
          </p>
          <p className="text-2xl font-mono tracking-[0.4em] text-[var(--accent)]">
            {code}
          </p>
        </div>
        <Link
          href="/trivia/live"
          className="text-xs text-[var(--muted)] hover:text-[var(--accent)] underline font-mono uppercase"
        >
          Live rooms
        </Link>
      </div>

      {identityChecked && !playerId && (
        <div className="rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-4 py-3 text-sm text-[var(--error)]">
          You are not the host of this room on this device.{" "}
          <Link href="/trivia/live" className="underline">
            Create a new room
          </Link>
          .
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-4 py-3 text-sm text-[var(--error)]">
          {error}
        </div>
      )}
      {advanceError && (
        <div className="rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-4 py-3 text-sm text-[var(--error)]">
          {advanceError}
        </div>
      )}

      {loading && !state && (
        <p className="text-center text-sm text-[var(--muted)] animate-pulse py-8">
          Loading room…
        </p>
      )}

      {state && state.status === "lobby" && (
        <div className="space-y-4">
          <PlayerList
            title={`Players (${state.players.length})`}
            players={state.players}
          />
          <button
            type="button"
            onClick={() => void advance()}
            disabled={!playerId || advancing || state.players.length === 0}
            className="w-full px-6 py-3 rounded-md bg-[var(--accent)] text-black text-sm font-medium hover:bg-[var(--accent-dim)] disabled:opacity-40 font-mono uppercase tracking-wide"
          >
            {advancing ? "Starting…" : "Start game"}
          </button>
          <p className="text-center text-xs text-[var(--muted)]">
            {state.players.length === 0
              ? "Waiting for at least one player to join…"
              : "Start whenever everyone is in."}
          </p>
        </div>
      )}

      {state && state.status === "playing" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 text-center space-y-2">
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] font-mono">
              Question {Math.min(state.currentIndex + 1, state.totalQuestions)} /{" "}
              {state.totalQuestions}
            </p>
            {state.currentQuestion && (
              <p className="text-lg font-medium leading-relaxed text-[var(--text)]">
                {state.currentQuestion.question}
              </p>
            )}
            {!state.answerRevealed && (
              <div className="mx-auto max-w-sm pt-2">
                <TriviaCountdown
                  startedAt={state.questionStartedAt}
                  durationSeconds={state.durationSeconds}
                  onExpire={() => void refresh()}
                />
              </div>
            )}
            {state.answerRevealed &&
              state.currentQuestion &&
              state.revealedCorrectIndex != null && (
                <p className="text-sm text-emerald-300 font-mono">
                  Answer:{" "}
                  {LABELS[state.revealedCorrectIndex] ??
                    state.revealedCorrectIndex + 1}{" "}
                  — {state.currentQuestion.choices[state.revealedCorrectIndex]}
                </p>
              )}
          </div>

          {state.answerRevealed ? (
            <>
              <PlayerList
                title="Scoreboard"
                players={state.players}
                showScores
              />
              <button
                type="button"
                onClick={() => void advance()}
                disabled={!playerId || advancing}
                className="w-full px-6 py-3 rounded-md bg-[var(--accent)] text-black text-sm font-medium hover:bg-[var(--accent-dim)] disabled:opacity-40 font-mono uppercase tracking-wide"
              >
                {advancing
                  ? "Loading…"
                  : state.currentIndex + 1 >= state.totalQuestions
                    ? "Finish game"
                    : "Next question"}
              </button>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-center">
                <p className="text-sm text-[var(--text)] font-mono">
                  {state.answeredCount} / {Math.max(state.players.length - 1, 0)}{" "}
                  answered
                </p>
                <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  Reveals automatically when the timer ends or everyone answers
                </p>
              </div>
              <button
                type="button"
                onClick={() => void reveal()}
                disabled={!playerId || revealing}
                className="w-full px-6 py-3 rounded-md border-2 border-[var(--accent)] text-[var(--accent)] text-sm font-medium hover:bg-[var(--accent)] hover:text-black transition-colors disabled:opacity-40 font-mono uppercase tracking-wide"
              >
                {revealing ? "Revealing…" : "Reveal now"}
              </button>
              <p className="text-center text-xs text-[var(--muted)]">
                Skip the timer and reveal the correct answer to everyone now.
              </p>
            </>
          )}
        </div>
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
          isHost
          onNewRoom={() => router.push("/trivia/live")}
        />
      )}
    </main>
  );
}

function PlayerList({
  title,
  players,
  showScores = false,
}: {
  title: string;
  players: { id: string; nickname: string; score: number }[];
  showScores?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-2">
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] font-mono">
        {title}
      </p>
      {players.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No players yet.</p>
      ) : (
        <ul className="space-y-1">
          {players.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between text-sm text-[var(--text)]"
            >
              <span className="truncate">{p.nickname}</span>
              {showScores && (
                <span className="tabular-nums text-[var(--accent)] font-mono">
                  {p.score}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
