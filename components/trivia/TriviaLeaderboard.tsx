"use client";

import {
  formatHiScoreDate,
  type TriviaHiScoreEntry,
} from "@/lib/trivia-hiscores";

type TriviaLeaderboardProps = {
  entries: TriviaHiScoreEntry[];
  loading?: boolean;
  error?: string | null;
  highlightId?: string | null;
  sessionScore?: number;
  onRefresh?: () => void;
  onPlayAgain?: () => void;
  onBack?: () => void;
};

export function TriviaLeaderboard({
  entries,
  loading = false,
  error = null,
  highlightId,
  sessionScore,
  onRefresh,
  onPlayAgain,
  onBack,
}: TriviaLeaderboardProps) {
  const rows = Array.from({ length: 10 }, (_, i) => entries[i] ?? null);

  return (
    <div className="animate-trivia-slide-up font-mono uppercase tracking-wide">
      <div className="trivia-retro-screen trivia-scanlines relative overflow-hidden">
        <div className="relative z-10 space-y-5 p-6 sm:p-8">
          <div className="text-center space-y-1">
            <p className="text-xs text-[var(--muted)]">— Save Data —</p>
            <h2 className="text-xl text-[var(--text)]">High Scores</h2>
            {sessionScore != null && (
              <p className="text-xs text-[var(--accent)]">
                Your run: {sessionScore}/10
              </p>
            )}
            <p className="text-[10px] text-[var(--muted)] normal-case tracking-normal">
              Global board · refreshes every 30s
            </p>
          </div>

          {error && (
            <p className="text-center text-sm text-[var(--error)] normal-case tracking-normal">
              {error}
            </p>
          )}

          {loading && entries.length === 0 ? (
            <p className="text-center text-sm text-[var(--muted)] animate-pulse py-8">
              Loading scores…
            </p>
          ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--muted)] text-xs border-b border-[var(--border)]">
                <th className="py-2 text-left w-10">#</th>
                <th className="py-2 text-left">Name</th>
                <th className="py-2 text-right">Score</th>
                <th className="py-2 text-right hidden sm:table-cell">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry, rank) => {
                const isTop = rank === 0 && entry != null;
                const isHighlight = entry?.id === highlightId;
                const empty = entry == null;

                return (
                  <tr
                    key={entry?.id ?? `empty-${rank}`}
                    className={`border-b border-[var(--border)]/60 last:border-0 ${
                      isHighlight
                        ? "animate-trivia-row-pulse bg-[var(--accent)]/15"
                        : ""
                    }`}
                  >
                    <td
                      className={`py-2.5 tabular-nums ${
                        isTop
                          ? "text-[var(--accent)]"
                          : empty
                            ? "text-[var(--border)]"
                            : "text-[var(--muted)]"
                      }`}
                    >
                      {String(rank + 1).padStart(2, "0")}
                    </td>
                    <td
                      className={`py-2.5 tracking-[0.2em] ${
                        isTop
                          ? "text-[var(--accent)] font-semibold"
                          : empty
                            ? "text-[var(--border)]"
                            : "text-[var(--muted)]"
                      } ${isHighlight ? "text-[var(--accent)]" : ""}`}
                    >
                      {empty ? "— — —" : entry.initials}
                    </td>
                    <td
                      className={`py-2.5 text-right tabular-nums ${
                        isTop
                          ? "text-[var(--accent)]"
                          : empty
                            ? "text-[var(--border)]"
                            : "text-[var(--muted)]"
                      } ${isHighlight ? "text-[var(--accent)]" : ""}`}
                    >
                      {empty ? "—/10" : `${entry.score}/${entry.total}`}
                    </td>
                    <td
                      className={`py-2.5 text-right text-xs hidden sm:table-cell ${
                        empty ? "text-[var(--border)]" : "text-[var(--muted)]"
                      }`}
                    >
                      {empty ? "—" : formatHiScoreDate(entry.date)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}

          <div className="flex flex-col items-center gap-3 pt-2">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={loading}
                className="text-xs text-[var(--muted)] hover:text-[var(--accent)] underline normal-case tracking-normal disabled:opacity-40"
              >
                {loading ? "Refreshing…" : "Refresh now"}
              </button>
            )}
            {onPlayAgain && (
              <button
                type="button"
                onClick={onPlayAgain}
                className="px-8 py-3 border-2 border-[var(--accent)] text-[var(--accent)] text-sm hover:bg-[var(--accent)] hover:text-black transition-colors"
              >
                ▶ Play Again
              </button>
            )}
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="px-8 py-3 border-2 border-[var(--border)] text-[var(--muted)] text-sm hover:border-[var(--accent-dim)] hover:text-[var(--text)] transition-colors"
              >
                ◀ Back to Game
              </button>
            )}
            {(onPlayAgain || onBack) && (
              <p className="text-[10px] text-[var(--muted)] animate-pulse">
                INSERT COIN TO CONTINUE
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
