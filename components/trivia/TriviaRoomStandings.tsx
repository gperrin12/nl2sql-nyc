"use client";

import Link from "next/link";

export type TriviaRoomStandingsPlayer = {
  id: string;
  nickname: string;
  score: number;
  correctCount: number;
};

type TriviaRoomStandingsProps = {
  players: TriviaRoomStandingsPlayer[];
  totalQuestions: number;
  currentPlayerId?: string;
  isHost?: boolean;
  onNewRoom?: () => void;
};

export function TriviaRoomStandings({
  players,
  totalQuestions,
  currentPlayerId,
  isHost = false,
  onNewRoom,
}: TriviaRoomStandingsProps) {
  // Sort by score desc; stable so ties keep join order (players arrive
  // ordered by joined_at from the state endpoint).
  const ranked = players
    .map((p, index) => ({ p, index }))
    .sort((a, b) => b.p.score - a.p.score || a.index - b.index)
    .map(({ p }) => p);

  return (
    <div className="animate-trivia-slide-up font-mono uppercase tracking-wide">
      <div className="trivia-retro-screen trivia-scanlines relative overflow-hidden">
        <div className="relative z-10 space-y-5 p-6 sm:p-8">
          <div className="text-center space-y-1">
            <p className="text-xs text-[var(--muted)]">— Final Standings —</p>
            <h2 className="text-xl text-[var(--text)]">Room Results</h2>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--muted)] text-xs border-b border-[var(--border)]">
                <th className="py-2 text-left w-10">#</th>
                <th className="py-2 text-left">Player</th>
                <th className="py-2 text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((player, rank) => {
                const isWinner = rank === 0;
                const isYou = player.id === currentPlayerId;

                return (
                  <tr
                    key={player.id}
                    className={`border-b border-[var(--border)]/60 last:border-0 ${
                      isYou
                        ? "animate-trivia-row-pulse bg-[var(--accent)]/15"
                        : ""
                    }`}
                  >
                    <td
                      className={`py-2.5 tabular-nums ${
                        isWinner
                          ? "text-[var(--accent)]"
                          : "text-[var(--muted)]"
                      }`}
                    >
                      {String(rank + 1).padStart(2, "0")}
                    </td>
                    <td
                      className={`py-2.5 tracking-wide truncate max-w-[12rem] sm:max-w-none ${
                        isWinner
                          ? "text-[var(--accent)] font-semibold"
                          : "text-[var(--muted)]"
                      } ${isYou ? "text-[var(--accent)]" : ""}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate">{player.nickname}</span>
                        {isWinner && (
                          <span className="shrink-0 rounded border border-[var(--accent)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                            Winner
                          </span>
                        )}
                        {isYou && !isWinner && (
                          <span className="shrink-0 text-[10px] text-[var(--accent)]">
                            (you)
                          </span>
                        )}
                      </span>
                    </td>
                    <td
                      className={`py-2.5 text-right tabular-nums ${
                        isWinner
                          ? "text-[var(--accent)]"
                          : "text-[var(--muted)]"
                      } ${isYou ? "text-[var(--accent)]" : ""}`}
                    >
                      {player.score}/{totalQuestions}
                    </td>
                  </tr>
                );
              })}
              {ranked.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="py-6 text-center text-[var(--muted)] normal-case tracking-normal"
                  >
                    No players
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="flex flex-col items-center gap-3 pt-2">
            {isHost ? (
              <button
                type="button"
                onClick={onNewRoom}
                className="px-8 py-3 border-2 border-[var(--accent)] text-[var(--accent)] text-sm hover:bg-[var(--accent)] hover:text-black transition-colors"
              >
                ▶ New Room
              </button>
            ) : (
              <Link
                href="/"
                className="px-8 py-3 border-2 border-[var(--border)] text-[var(--muted)] text-sm hover:border-[var(--accent-dim)] hover:text-[var(--text)] transition-colors normal-case tracking-normal"
              >
                ◀ Back to home
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
