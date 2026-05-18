"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HISCORE_NAME_MAX_LENGTH } from "@/lib/trivia-hiscores";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DIGITS = "0123456789".split("");
const SPECIAL = [" ", "-", "'"] as const;
const CHARSET = [...LETTERS, ...DIGITS, ...SPECIAL];
const COLS = 8;

type TriviaNamePickerProps = {
  score: number;
  total: number;
  disabled?: boolean;
  onComplete: (name: string) => void;
  onSkip?: () => void;
};

function emptySlots(): string[] {
  return Array.from({ length: HISCORE_NAME_MAX_LENGTH }, () => "");
}

export function TriviaNamePicker({
  score,
  total,
  disabled = false,
  onComplete,
  onSkip,
}: TriviaNamePickerProps) {
  const [chars, setChars] = useState(emptySlots);
  const [slotIndex, setSlotIndex] = useState(0);
  const [gridIndex, setGridIndex] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setCursorVisible((v) => !v), 530);
    return () => window.clearInterval(id);
  }, []);

  const composedName = chars.join("").trim().toUpperCase();

  const submitName = useCallback(() => {
    if (disabled || composedName.length < 1) return;
    onComplete(composedName.slice(0, HISCORE_NAME_MAX_LENGTH));
  }, [composedName, disabled, onComplete]);

  const pickChar = useCallback(
    (ch: string) => {
      if (disabled) return;
      setChars((prev) => {
        const next = [...prev];
        next[slotIndex] = ch;
        return next;
      });
      if (slotIndex < HISCORE_NAME_MAX_LENGTH - 1) {
        setSlotIndex((s) => s + 1);
        setGridIndex(0);
      }
    },
    [slotIndex, disabled]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setGridIndex((i) => {
            const r = Math.floor(i / COLS);
            const c = i % COLS;
            const maxRow = Math.ceil(CHARSET.length / COLS) - 1;
            const nr = (r - 1 + maxRow + 1) % (maxRow + 1);
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
          e.preventDefault();
          if (e.shiftKey || slotIndex === HISCORE_NAME_MAX_LENGTH - 1) {
            submitName();
          } else {
            pickChar(CHARSET[gridIndex] ?? "A");
          }
          break;
        case " ":
          e.preventDefault();
          pickChar(CHARSET[gridIndex] ?? "A");
          break;
        case "Backspace":
          e.preventDefault();
          setChars((prev) => {
            const next = [...prev];
            if (next[slotIndex] !== "") {
              next[slotIndex] = "";
              return next;
            }
            if (slotIndex > 0) {
              const ni = slotIndex - 1;
              next[ni] = "";
              setSlotIndex(ni);
            }
            return next;
          });
          break;
        case "Tab":
          e.preventDefault();
          setSlotIndex((s) =>
            e.shiftKey
              ? Math.max(0, s - 1)
              : Math.min(HISCORE_NAME_MAX_LENGTH - 1, s + 1)
          );
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gridIndex, pickChar, slotIndex, submitName]);

  const displayChars = chars.map((c, i) => {
    const show = i === slotIndex && cursorVisible;
    return show ? (c || "_") : c || "_";
  });

  return (
    <div
      ref={containerRef}
      className="trivia-retro-screen font-mono uppercase tracking-wider space-y-6 py-6"
      tabIndex={-1}
    >
      <div className="text-center space-y-2">
        <p className="text-xs text-[var(--muted)]">— Save Data —</p>
        <h2 className="text-xl text-[var(--accent)]">Enter Name</h2>
        <p className="text-xs text-[var(--muted)] normal-case tracking-normal">
          Score {score}/{total} · up to {HISCORE_NAME_MAX_LENGTH} characters
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2 max-w-md mx-auto text-2xl sm:text-3xl tabular-nums">
        {displayChars.map((ch, i) => (
          <span
            key={i}
            className={`w-8 h-10 sm:w-9 sm:h-12 flex items-center justify-center border-2 text-sm sm:text-base ${
              i === slotIndex
                ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
                : "border-[var(--border)] text-[var(--muted)]"
            }`}
          >
            {ch === " " ? "·" : ch}
          </span>
        ))}
      </div>

      <div
        className="grid gap-1 max-w-lg mx-auto"
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
              className={`h-9 text-xs sm:text-sm border transition-colors disabled:opacity-40 ${
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

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          disabled={disabled || composedName.length < 1}
          onClick={submitName}
          className="px-8 py-2.5 border-2 border-[var(--accent)] text-[var(--accent)] text-sm hover:bg-[var(--accent)] hover:text-black transition-colors disabled:opacity-40"
        >
          Save Name ▶
        </button>
        {onSkip && (
          <button
            type="button"
            disabled={disabled}
            onClick={onSkip}
            className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline normal-case tracking-normal"
          >
            Skip (save as GUEST)
          </button>
        )}
      </div>
    </div>
  );
}
