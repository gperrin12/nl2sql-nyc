"use client";

import { useEffect, useRef, useState } from "react";

/** Seconds left in the question window, mirroring lib/trivia-room's server-side
 * helper. Reimplemented here so this client component never pulls in the
 * server-only trivia generation modules that lib/trivia-room re-exports. */
function computeRemaining(
  startedAt: string | null,
  durationSeconds: number
): number {
  if (!startedAt) return durationSeconds;
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return 0;
  const elapsed = (Date.now() - started) / 1000;
  return Math.max(0, Math.ceil(durationSeconds - elapsed));
}

/**
 * Ticking per-question countdown for live trivia. Ticks locally every 250ms off
 * the server-provided start time so it stays smooth between 1.5s state polls, and
 * fires `onExpire` once when it reaches zero (used to nudge an immediate refresh
 * so the auto-revealed answer shows without waiting for the next poll).
 */
export function TriviaCountdown({
  startedAt,
  durationSeconds,
  paused = false,
  onExpire,
}: {
  startedAt: string | null;
  durationSeconds: number;
  paused?: boolean;
  onExpire?: () => void;
}) {
  const [remaining, setRemaining] = useState(() =>
    computeRemaining(startedAt, durationSeconds)
  );
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    setRemaining(computeRemaining(startedAt, durationSeconds));
  }, [startedAt, durationSeconds]);

  useEffect(() => {
    if (paused) return;
    const tick = () => {
      const r = computeRemaining(startedAt, durationSeconds);
      setRemaining(r);
      if (r <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpire?.();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [startedAt, durationSeconds, paused, onExpire]);

  if (!startedAt) return null;

  const pct =
    durationSeconds > 0
      ? Math.max(0, Math.min(100, (remaining / durationSeconds) * 100))
      : 0;
  const low = remaining <= 10;
  const color = low ? "var(--error)" : "var(--accent)";

  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide font-mono text-[var(--muted)]">
        <span>Time left</span>
        <span
          className={`tabular-nums font-semibold ${low ? "animate-pulse" : ""}`}
          style={{ color }}
        >
          {remaining}s
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
        <div
          className="h-full rounded-full transition-[width] duration-200 ease-linear"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
