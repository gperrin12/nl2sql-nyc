"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TriviaSessionConstraints } from "@/lib/trivia-categories";
import {
  fetchTriviaQuestion,
  type TriviaQuestionResponse,
} from "@/lib/trivia-fetch";

export type TriviaQuestionLoadedMeta = {
  question: string;
  categoryId?: string;
};

/**
 * Loads trivia questions with a one-ahead prefetch.
 * Pass getSessionConstraints() so each slot uses the session category plan
 * and avoids repeating similar questions.
 */
export function useTriviaQuestion(options?: {
  getSessionConstraints?: () => TriviaSessionConstraints;
  onQuestionLoaded?: (meta: TriviaQuestionLoadedMeta) => void;
  /** Bump to reset cache and reload (new 10-question run). */
  sessionKey?: number;
}) {
  const [current, setCurrent] = useState<TriviaQuestionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefetchReady, setPrefetchReady] = useState(false);

  const cacheRef = useRef<TriviaQuestionResponse | null>(null);
  const prefetchPromiseRef = useRef<Promise<void> | null>(null);
  const advanceGenRef = useRef(0);

  const getConstraintsRef = useRef(options?.getSessionConstraints);
  const onLoadedRef = useRef(options?.onQuestionLoaded);
  getConstraintsRef.current = options?.getSessionConstraints;
  onLoadedRef.current = options?.onQuestionLoaded;

  const notifyLoaded = useCallback((data: TriviaQuestionResponse) => {
    onLoadedRef.current?.({
      question: data.question,
      categoryId: data.categoryId,
    });
  }, []);

  const startPrefetch = useCallback(() => {
    if (cacheRef.current || prefetchPromiseRef.current) return;

    setPrefetchReady(false);

    const promise = fetchTriviaQuestion(getConstraintsRef.current?.())
      .then((data) => {
        cacheRef.current = data;
        setPrefetchReady(true);
      })
      .catch(() => {
        cacheRef.current = null;
        setPrefetchReady(false);
      })
      .finally(() => {
        prefetchPromiseRef.current = null;
      });

    prefetchPromiseRef.current = promise;
  }, []);

  const consumeCached = useCallback((): TriviaQuestionResponse | null => {
    if (!cacheRef.current) return null;
    const data = cacheRef.current;
    cacheRef.current = null;
    setPrefetchReady(false);
    return data;
  }, []);

  const applyQuestion = useCallback(
    (data: TriviaQuestionResponse) => {
      setCurrent(data);
      notifyLoaded(data);
      startPrefetch();
    },
    [notifyLoaded, startPrefetch]
  );

  const advance = useCallback(async () => {
    const gen = ++advanceGenRef.current;
    setError(null);

    const cached = consumeCached();
    if (cached) {
      applyQuestion(cached);
      return;
    }

    setCurrent(null);
    setAdvancing(true);

    try {
      if (prefetchPromiseRef.current) {
        await prefetchPromiseRef.current;
      }

      if (gen !== advanceGenRef.current) return;

      const fromPrefetch = consumeCached();
      const data =
        fromPrefetch ??
        (await fetchTriviaQuestion(getConstraintsRef.current?.()));

      if (gen !== advanceGenRef.current) return;
      applyQuestion(data);
    } catch (e) {
      if (gen !== advanceGenRef.current) return;
      setError(e instanceof Error ? e.message : "Failed to load question");
    } finally {
      if (gen === advanceGenRef.current) {
        setAdvancing(false);
      }
    }
  }, [applyQuestion, consumeCached, startPrefetch]);

  const sessionKey = options?.sessionKey ?? 0;

  useEffect(() => {
    let cancelled = false;
    cacheRef.current = null;
    prefetchPromiseRef.current = null;
    setPrefetchReady(false);
    setCurrent(null);
    setLoading(true);
    setError(null);
    advanceGenRef.current += 1;

    void (async () => {
      try {
        const data = await fetchTriviaQuestion(getConstraintsRef.current?.());
        if (cancelled) return;
        setCurrent(data);
        notifyLoaded(data);
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
  }, [sessionKey, notifyLoaded, startPrefetch]);

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
