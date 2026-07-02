"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicTriviaRoomQuestion } from "@/lib/trivia-room";

export type TriviaRoomPlayer = {
  id: string;
  nickname: string;
  score: number;
  /** Present only once the room is finished. */
  correctCount?: number;
};

export type TriviaRoomState = {
  status: "lobby" | "playing" | "finished";
  currentIndex: number;
  questionStartedAt: string | null;
  durationSeconds: number;
  totalQuestions: number;
  players: TriviaRoomPlayer[];
  currentQuestion: PublicTriviaRoomQuestion | null;
};

/** Slow the poll to 5s once the game is over — nothing else will change. */
const FINISHED_INTERVAL_MS = 5000;

/**
 * Polls /api/trivia-room/[code]/state on an interval, mirroring the fetch/error
 * conventions of useTriviaQuestion. Polling continues (slowed) while finished
 * so late-arriving final scores still settle.
 */
export function useTriviaRoomState({
  code,
  playerId,
  intervalMs = 1500,
}: {
  code: string;
  playerId?: string;
  intervalMs?: number;
}) {
  const [state, setState] = useState<TriviaRoomState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const statusRef = useRef<TriviaRoomState["status"] | null>(null);
  statusRef.current = state?.status ?? null;

  const fetchState = useCallback(async () => {
    const query = playerId ? `?playerId=${encodeURIComponent(playerId)}` : "";
    try {
      const res = await fetch(
        `/api/trivia-room/${encodeURIComponent(code)}/state${query}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as TriviaRoomState & {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(data.detail ?? data.error ?? "Failed to load room");
      }
      setState(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load room");
    } finally {
      setLoading(false);
    }
  }, [code, playerId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      await fetchState();
      if (cancelled) return;
      const nextDelay =
        statusRef.current === "finished" ? FINISHED_INTERVAL_MS : intervalMs;
      timer = setTimeout(() => void tick(), nextDelay);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [fetchState, intervalMs]);

  return { state, loading, error, refresh: fetchState };
}
