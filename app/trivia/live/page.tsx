"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { CrtWelcome } from "@/components/CrtWelcome";
import {
  DEFAULT_ROOM_QUESTION_COUNT,
  ROOM_QUESTION_COUNT_OPTIONS,
  type RoomQuestionCount,
} from "@/lib/trivia-room-constants";

function rememberIdentity(code: string, playerId: string, nickname: string) {
  try {
    localStorage.setItem(
      `nl2sql-trivia-room-${code}`,
      JSON.stringify({ playerId, nickname })
    );
  } catch {
    // Non-fatal — the id is also passed forward in the URL flow.
  }
}

export default function TriviaLiveLandingPage() {
  const router = useRouter();
  const [hostNickname, setHostNickname] = useState("");
  const [questionCount, setQuestionCount] = useState<RoomQuestionCount>(
    DEFAULT_ROOM_QUESTION_COUNT
  );
  const [joinCode, setJoinCode] = useState("");
  const [joinNickname, setJoinNickname] = useState("");
  const [hosting, setHosting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleHost = async () => {
    const nickname = hostNickname.trim();
    if (!nickname || hosting) return;
    setHosting(true);
    setError(null);
    try {
      const res = await fetch("/api/trivia-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostNickname: nickname, questionCount }),
      });
      const data = (await res.json()) as {
        code?: string;
        playerId?: string;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.code || !data.playerId) {
        throw new Error(data.detail ?? data.error ?? "Failed to create room");
      }
      rememberIdentity(data.code, data.playerId, nickname);
      router.push(`/trivia/live/${data.code}/host`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create room");
      setHosting(false);
    }
  };

  const handleJoin = async () => {
    const nickname = joinNickname.trim();
    const code = joinCode.trim().toUpperCase();
    if (!nickname || !code || joining) return;
    setJoining(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/trivia-room/${encodeURIComponent(code)}/join`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname }),
        }
      );
      const data = (await res.json()) as {
        playerId?: string;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.playerId) {
        throw new Error(data.detail ?? data.error ?? "Failed to join room");
      }
      rememberIdentity(code, data.playerId, nickname);
      router.push(`/trivia/live/${code}/play`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join room");
      setJoining(false);
    }
  };

  return (
    <main className="crt-root max-w-3xl mx-auto p-6 space-y-6">
      <AppNav />

      <CrtWelcome>
        <p className="text-[var(--muted)] text-sm">
          live multiplayer trivia :: create a room, share the code, play together
        </p>
      </CrtWelcome>

      <div className="flex items-center justify-between">
        <h1 className="font-mono uppercase tracking-wide text-lg text-[var(--text)]">
          Live Rooms
        </h1>
        <Link
          href="/trivia"
          className="text-xs text-[var(--muted)] hover:text-[var(--accent)] underline font-mono uppercase"
        >
          Solo mode
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-4 py-3 text-sm text-[var(--error)]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 space-y-4">
          <h2 className="font-mono uppercase tracking-wide text-sm text-[var(--accent)]">
            Host a room
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Generates a fixed set of questions. Building the deck may take a
            little while.
          </p>
          <input
            type="text"
            value={hostNickname}
            onChange={(e) => setHostNickname(e.target.value)}
            placeholder="Your nickname"
            maxLength={24}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent-dim)]"
          />
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] font-mono">
              Questions per round
            </p>
            <div className="grid grid-cols-3 gap-2">
              {ROOM_QUESTION_COUNT_OPTIONS.map((count) => {
                const active = questionCount === count;
                return (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setQuestionCount(count)}
                    disabled={hosting}
                    aria-pressed={active}
                    className={`rounded-md border px-3 py-2 text-sm font-mono tabular-nums transition-colors disabled:opacity-40 ${
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:border-[var(--accent-dim)]"
                    }`}
                  >
                    {count}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleHost()}
            disabled={hosting || hostNickname.trim().length === 0}
            className="w-full px-6 py-2.5 rounded-md bg-[var(--accent)] text-black text-sm font-medium hover:bg-[var(--accent-dim)] disabled:opacity-40 font-mono uppercase tracking-wide"
          >
            {hosting ? "Building deck…" : "Host a room"}
          </button>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 space-y-4">
          <h2 className="font-mono uppercase tracking-wide text-sm text-[var(--accent)]">
            Join a room
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Enter the 6-character code the host shared with you.
          </p>
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Room code"
            maxLength={6}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent-dim)] font-mono uppercase tracking-[0.3em]"
          />
          <input
            type="text"
            value={joinNickname}
            onChange={(e) => setJoinNickname(e.target.value)}
            placeholder="Your nickname"
            maxLength={24}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent-dim)]"
          />
          <button
            type="button"
            onClick={() => void handleJoin()}
            disabled={
              joining ||
              joinNickname.trim().length === 0 ||
              joinCode.trim().length === 0
            }
            className="w-full px-6 py-2.5 rounded-md border-2 border-[var(--accent)] text-[var(--accent)] text-sm font-medium hover:bg-[var(--accent)] hover:text-black transition-colors disabled:opacity-40 font-mono uppercase tracking-wide"
          >
            {joining ? "Joining…" : "Join a room"}
          </button>
        </section>
      </div>
    </main>
  );
}
