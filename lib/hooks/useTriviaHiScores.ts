"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addHiScoreEntry,
  loadTriviaHiScores,
  qualifiesForHiScores,
  TRIVIA_HISCORES_STORAGE_KEY,
  type TriviaHiScoreEntry,
} from "@/lib/trivia-hiscores";

export function useTriviaHiScores() {
  const [board, setBoard] = useState<TriviaHiScoreEntry[]>(() =>
    loadTriviaHiScores()
  );

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TRIVIA_HISCORES_STORAGE_KEY) {
        setBoard(loadTriviaHiScores());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const qualifies = useCallback(
    (score: number) => qualifiesForHiScores(score, board),
    [board]
  );

  const submitScore = useCallback(
    (initials: string, score: number) => {
      const { board: next, entry } = addHiScoreEntry(board, initials, score);
      setBoard(next);
      return entry;
    },
    [board]
  );

  const refresh = useCallback(() => {
    setBoard(loadTriviaHiScores());
  }, []);

  return { board, qualifies, submitScore, refresh };
}
