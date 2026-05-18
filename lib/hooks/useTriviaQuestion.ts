"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchTriviaQuestion,
  type TriviaQuestionResponse,
} from "@/lib/trivia-fetch";

/**
 * Loads trivia questions with a one-ahead prefetch so "Next Question"
 * is often instant while the user reads the current question.
 */
export function useTriviaQuestion() {
  const [current, setCurrent] = useState<TriviaQuestionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingNext, setLoadingNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefetchReady, setPrefetchReady] = useState(false);

  const cacheRef = useRef<TriviaQuestionResponse | null>(null);
  const inflightRef = useRef<Promise<TriviaQuestionResponse> | null>(null);

  const startPrefetch = useCallback(() => {
    if (cacheRef.current || inflightRef.current) return;

    const promise = fetchTriviaQuestion()
      .then((data) => {
        cacheRef.current = data;
        setPrefetchReady(true);
        return data;
      })
      .catch(() => {
        cacheRef.current = null;
        setPrefetchReady(false);
        throw new Error("Prefetch failed");
      })
      .finally(() => {
        inflightRef.current = null;
      });

    inflightRef.current = promise;
  }, []);

  const takeFromCache = useCallback(async (): Promise<TriviaQuestionResponse> => {
    if (cacheRef.current) {
      const data = cacheRef.current;
      cacheRef.current = null;
      setPrefetchReady(false);
      return data;
    }
    if (inflightRef.current) {
      try {
        const data = await inflightRef.current;
        if (cacheRef.current) {
          const cached = cacheRef.current;
          cacheRef.current = null;
          setPrefetchReady(false);
          return cached;
        }
        return data;
      } catch {
        return fetchTriviaQuestion();
      }
    }
    return fetchTriviaQuestion();
  }, []);

  const loadNext = useCallback(async () => {
    setError(null);
    const hasCurrent = current != null;
    if (hasCurrent) {
      setLoadingNext(true);
    } else {
      setLoading(true);
    }

    try {
      const data = await takeFromCache();
      setCurrent(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load question");
    } finally {
      setLoading(false);
      setLoadingNext(false);
      startPrefetch();
    }
  }, [current, startPrefetch, takeFromCache]);

  useEffect(() => {
    void loadNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (current && !cacheRef.current && !inflightRef.current) {
      startPrefetch();
    }
  }, [current, startPrefetch]);

  return {
    current,
    loading,
    loadingNext,
    error,
    prefetchReady,
    loadNext,
    retry: loadNext,
  };
}
