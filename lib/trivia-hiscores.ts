/**
 * Local hi-score board for 10-question trivia sessions (localStorage).
 */

export const TRIVIA_HISCORES_STORAGE_KEY = "nyc-trivia-hiscores";
export const TRIVIA_SESSION_LENGTH = 10;
export const TRIVIA_LEADERBOARD_SIZE = 10;

export type TriviaHiScoreEntry = {
  id: string;
  initials: string;
  score: number;
  total: number;
  date: string;
};

function isHiScoreEntry(value: unknown): value is TriviaHiScoreEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.initials === "string" &&
    typeof e.score === "number" &&
    typeof e.total === "number" &&
    typeof e.date === "string"
  );
}

export function sortHiScores(entries: TriviaHiScoreEntry[]): TriviaHiScoreEntry[] {
  return [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });
}

export function loadTriviaHiScores(): TriviaHiScoreEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TRIVIA_HISCORES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isHiScoreEntry);
    return sortHiScores(valid).slice(0, TRIVIA_LEADERBOARD_SIZE);
  } catch {
    return [];
  }
}

export function saveTriviaHiScores(entries: TriviaHiScoreEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    const sorted = sortHiScores(entries).slice(0, TRIVIA_LEADERBOARD_SIZE);
    localStorage.setItem(TRIVIA_HISCORES_STORAGE_KEY, JSON.stringify(sorted));
  } catch {
    // Quota or private mode
  }
}

export function qualifiesForHiScores(
  score: number,
  board: TriviaHiScoreEntry[]
): boolean {
  if (board.length < TRIVIA_LEADERBOARD_SIZE) return true;
  const lowest = board[board.length - 1]?.score ?? 0;
  return score >= lowest;
}

export function addHiScoreEntry(
  board: TriviaHiScoreEntry[],
  initials: string,
  score: number,
  total: number = TRIVIA_SESSION_LENGTH
): { board: TriviaHiScoreEntry[]; entry: TriviaHiScoreEntry } {
  const entry: TriviaHiScoreEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    initials: initials.toUpperCase().slice(0, 3).padEnd(3, " "),
    score,
    total,
    date: new Date().toISOString(),
  };
  const next = sortHiScores([...board, entry]).slice(0, TRIVIA_LEADERBOARD_SIZE);
  saveTriviaHiScores(next);
  return { board: next, entry };
}

export function formatHiScoreDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "2-digit",
    });
  } catch {
    return "—";
  }
}
