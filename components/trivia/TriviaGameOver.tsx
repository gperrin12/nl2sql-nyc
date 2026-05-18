"use client";

type TriviaGameOverProps = {
  score: number;
  total: number;
  onContinue: () => void;
};

export function TriviaGameOver({ score, total, onContinue }: TriviaGameOverProps) {
  const pct = Math.round((score / total) * 100);

  return (
    <div className="trivia-retro-screen animate-trivia-fade-in font-mono uppercase tracking-wider text-center space-y-8 py-10">
      <div className="space-y-2">
        <p className="text-xs text-[var(--muted)] animate-pulse">
          ▶ INSERT COIN ◀
        </p>
        <h2 className="text-3xl sm:text-4xl text-[var(--error)] drop-shadow-[0_0_12px_rgba(239,68,68,0.35)]">
          Game Over
        </h2>
      </div>

      <div className="space-y-4">
        <p className="text-sm text-[var(--muted)]">Final Score</p>
        <p className="text-5xl sm:text-6xl tabular-nums text-[var(--accent)]">
          {score}
          <span className="text-2xl text-[var(--muted)]"> / {total}</span>
        </p>
        <p className="text-sm text-[var(--muted)]">{pct}% correct</p>
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="px-8 py-3 border-2 border-[var(--accent)] text-[var(--accent)] text-sm hover:bg-[var(--accent)] hover:text-black transition-colors"
      >
        Continue ▶
      </button>
    </div>
  );
}
