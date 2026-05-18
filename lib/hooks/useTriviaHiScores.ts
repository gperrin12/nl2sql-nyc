"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  qualifiesForHiScores,
  TRIVIA_SESSION_LENGTH,
  type TriviaHiScoreEntry,
} from "@/lib/trivia-hiscores";

const POLL_MS = 30_000;

function formatApiError(message: string, detail?: string): string {
  if (!detail || detail === message) return message;
  return `${message}: ${detail}`;
}

async function fetchHiScores(): Promise<TriviaHiScoreEntry[]> {
  const res = await fetch("/api/trivia/hiscores", { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
    };
    throw new Error(
      formatApiError(body.error ?? `Failed to load hi-scores (${res.status})`, body.detail)
    );
  }
  const data = (await res.json()) as { entries: TriviaHiScoreEntry[] };
  return data.entries ?? [];
}

export function useTriviaHiScores(options?: { pollWhileLeaderboard?: boolean }) {
  const [board, setBoard] = useState<TriviaHiScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollWhileLeaderboard = options?.pollWhileLeaderboard ?? false;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const entries = await fetchHiScores();
      if (mountedRef.current) setBoard(entries);
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!pollWhileLeaderboard) return;
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [pollWhileLeaderboard, refresh]);

  const qualifies = useCallback(
    (score: number) => qualifiesForHiScores(score, board),
    [board]
  );

  const submitScore = useCallback(
    async (name: string, score: number): Promise<TriviaHiScoreEntry> => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/trivia/hiscores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, score, total: TRIVIA_SESSION_LENGTH }),
        });
        const data = (await res.json()) as {
          entries?: TriviaHiScoreEntry[];
          entry?: TriviaHiScoreEntry;
          error?: string;
          detail?: string;
        };
        if (!res.ok) {
          throw new Error(
            formatApiError(
              data.error ?? `Failed to save score (${res.status})`,
              data.detail
            )
          );
        }
        const entries = data.entries ?? [];
        const entry = data.entry;
        if (!entry) {
          throw new Error("Server did not return the new entry");
        }
        setBoard(entries);
        return entry;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setSubmitting(false);
      }
    },
    []
  );

  return {
    board,
    loading,
    submitting,
    error,
    qualifies,
    submitScore,
    refresh,
  };
}
