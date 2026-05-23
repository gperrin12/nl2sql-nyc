"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadTriviaScore,
  recordTriviaAnswer,
  TRIVIA_SCORE_STORAGE_KEY,
  triviaAccuracy,
  type TriviaScoreRecord,
} from "@/lib/trivia-score";

export function useTriviaScore() {
  const [score, setScore] = useState<TriviaScoreRecord>(() => loadTriviaScore());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TRIVIA_SCORE_STORAGE_KEY) {
        setScore(loadTriviaScore());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const recordAnswer = useCallback((wasCorrect: boolean) => {
    setScore((prev) => recordTriviaAnswer(prev, wasCorrect));
  }, []);

  const accuracy = triviaAccuracy(score);

  return {
    correct: score.correct,
    answered: score.answered,
    bestStreak: score.bestStreak,
    currentStreak: score.currentStreak,
    accuracy,
    recordAnswer,
  };
}
