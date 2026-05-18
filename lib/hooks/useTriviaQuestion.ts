"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchTriviaQuestion,
  type TriviaQuestionResponse,
} from "@/lib/trivia-fetch";

/**
 * Loads trivia questions with a one-ahead prefetch.
 * Prefetch never mutates `current` — only "Next Question" swaps it in.
 */
export function useTriviaQuestion() {
  const [current, setCurrent] = useState<TriviaQuestionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefetchReady, setPrefetchReady] = useState(false);

  const cacheRef = useRef<TriviaQuestionResponse | null>(null);
  const prefetchInflightRef = useRef(false);
  const advanceGenRef = useRef(0);

  const startPrefetch = useCallback(() => {
    if (cacheRef.current || prefetchInflightRef.current) return;

    prefetchInflightRef.current = true;
    setPrefetchReady(false);

    void fetchTriviaQuestion()
      .then((data) => {
        cacheRef.current = data;
        setPrefetchReady(true);
      })
      .catch(() => {
        cacheRef.current = null;
        setPrefetchReady(false);
      })
      .finally(() => {
        prefetchInflightRef.current = false;
      });
  }, []);

  const consumeCached = useCallback((): TriviaQuestionResponse | null => {
    if (!cacheRef.current) return null;
    const data = cacheRef.current;
    cacheRef.current = null;
    setPrefetchReady(false);
    return data;
  }, []);

  const advance = useCallback(async () => {
    const gen = ++advanceGenRef.current;
    setError(null);

    const cached = consumeCached();
    if (cached) {
      setCurrent(cached);
      startPrefetch();
      return;
    }

    setAdvancing(true);
    try {
      let data: TriviaQuestionResponse;

      if (prefetchInflightRef.current) {
        await new Promise<void>((resolve) => {
          const tick = () => {
            if (!prefetchInflightRef.current) {
              resolve();
              return;
            }
            window.setTimeout(tick, 100);
          };
          tick();
        });
        const afterWait = consumeCached();
        if (afterWait) {
          data = afterWait;
        } else {
          data = await fetchTriviaQuestion();
        }
      } else {
        data = await fetchTriviaQuestion();
      }

      if (gen !== advanceGenRef.current) return;
      setCurrent(data);
      startPrefetch();
    } catch (e) {
      if (gen !== advanceGenRef.current) return;
      setError(e instanceof Error ? e.message : "Failed to load question");
    } finally {
      if (gen === advanceGenRef.current) {
        setAdvancing(false);
      }
    }
  }, [consumeCached, startPrefetch]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchTriviaQuestion();
        if (cancelled) return;
        setCurrent(data);
        startPrefetch();
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load question");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      advanceGenRef.current += 1;
    };
  }, [startPrefetch]);

  return {
    current,
    loading,
    advancing,
    error,
    prefetchReady,
    advance,
    retry: advance,
  };
}
