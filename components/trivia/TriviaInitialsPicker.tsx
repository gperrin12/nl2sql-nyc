"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const SPECIAL = [" ", "!", "?"] as const;
const CHARSET = [...LETTERS, ...SPECIAL];
const COLS = 6;
const MAX_INITIALS = 3;

type TriviaInitialsPickerProps = {
  score: number;
  total: number;
  disabled?: boolean;
  onComplete: (initials: string) => void;
  onSkip?: () => void;
};

export function TriviaInitialsPicker({
  score,
  total,
  disabled = false,
  onComplete,
  onSkip,
}: TriviaInitialsPickerProps) {
  const [chars, setChars] = useState<string[]>(["", "", ""]);
  const [slotIndex, setSlotIndex] = useState(0);
  const [gridIndex, setGridIndex] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setCursorVisible((v) => !v), 530);
    return () => window.clearInterval(id);
  }, []);

  const pickChar = useCallback(
    (ch: string) => {
      if (disabled) return;
      const next = [...chars];
      next[slotIndex] = ch;
      setChars(next);
      if (slotIndex < MAX_INITIALS - 1) {
        setSlotIndex((s) => s + 1);
        setGridIndex(0);
      } else {
        const initials = next.join("").toUpperCase().padEnd(3, " ").slice(0, 3);
        onComplete(initials);
      }
    },
    [slotIndex, chars, onComplete, disabled]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const row = Math.floor(gridIndex / COLS);
      const col = gridIndex % COLS;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setGridIndex((i) => {
            const r = Math.floor(i / COLS);
            const c = i % COLS;
            const nr = (r - 1 + Math.ceil(CHARSET.length / COLS)) % Math.ceil(CHARSET.length / COLS);
            return Math.min(nr * COLS + c, CHARSET.length - 1);
          });
          break;
        case "ArrowDown":
          e.preventDefault();
          setGridIndex((i) => {
            const r = Math.floor(i / COLS);
            const c = i % COLS;
            const maxRow = Math.ceil(CHARSET.length / COLS) - 1;
            const nr = Math.min(r + 1, maxRow);
            return Math.min(nr * COLS + c, CHARSET.length - 1);
          });
          break;
        case "ArrowLeft":
          e.preventDefault();
          setGridIndex((i) => (i % COLS === 0 ? i : i - 1));
          break;
        case "ArrowRight":
          e.preventDefault();
          setGridIndex((i) =>
            i % COLS === COLS - 1 || i >= CHARSET.length - 1 ? i : i + 1
          );
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          pickChar(CHARSET[gridIndex] ?? "A");
          break;
        case "Backspace":
          e.preventDefault();
          if (slotIndex > 0 && chars[slotIndex] === "") {
            setSlotIndex((s) => s - 1);
          }
          setChars((prev) => {
            const next = [...prev];
            next[slotIndex] = "";
            return next;
          });
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gridIndex, pickChar, slotIndex, chars]);

  const displayChars = chars.map((c, i) =>
    i === slotIndex && cursorVisible ? (c || "_") : c || "_"
  );

  return (
    <div
      ref={containerRef}
      className="trivia-retro-screen font-mono uppercase tracking-wider space-y-6 py-6"
      tabIndex={-1}
    >
      <div className="text-center space-y-2">
        <p className="text-xs text-[var(--muted)] animate-pulse">
          ▶ NEW HIGH SCORE ◀
        </p>
        <h2 className="text-xl text-[var(--accent)]">Enter Initials</h2>
        <p className="text-xs text-[var(--muted)]">
          Score {score}/{total} — arrows + enter, or click
        </p>
      </div>

      <div className="flex justify-center gap-3 text-3xl tabular-nums">
        {displayChars.map((ch, i) => (
          <span
            key={i}
            className={`w-12 h-14 flex items-center justify-center border-2 ${
              i === slotIndex
                ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
                : "border-[var(--border)] text-[var(--muted)]"
            }`}
          >
            {ch}
          </span>
        ))}
      </div>

      <div
        className="grid gap-1 max-w-xs mx-auto"
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
      >
        {CHARSET.map((ch, i) => {
          const label = ch === " " ? "SPC" : ch;
          const focused = i === gridIndex;
          return (
            <button
              key={`${ch}-${i}`}
              type="button"
              disabled={disabled}
              onClick={() => pickChar(ch)}
              className={`h-10 text-sm border transition-colors disabled:opacity-40 ${
                focused
                  ? "border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--panel)] text-[var(--text)] hover:border-[var(--accent-dim)]"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {onSkip && (
        <p className="text-center">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline"
          >
            Skip (use ???)
          </button>
        </p>
      )}
    </div>
  );
}
