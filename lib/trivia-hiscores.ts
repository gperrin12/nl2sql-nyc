/**
 * Trivia hi-score types and merge/sort helpers (client + server).
 * Persistence: S3 via lib/trivia-hiscores-store.ts and /api/trivia/hiscores.
 */

export const TRIVIA_SESSION_LENGTH = 10;
export const TRIVIA_LEADERBOARD_SIZE = 10;

/** @deprecated Browser cache key; global board uses the API + S3. */
export const TRIVIA_HISCORES_STORAGE_KEY = "nyc-trivia-hiscores";

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

export function parseHiScoresJson(raw: string): TriviaHiScoreEntry[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isHiScoreEntry);
}

export function normalizeInitials(initials: string): string {
  return initials.toUpperCase().slice(0, 3).padEnd(3, " ");
}

export function buildHiScoreEntry(
  initials: string,
  score: number,
  total: number = TRIVIA_SESSION_LENGTH
): TriviaHiScoreEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    initials: normalizeInitials(initials),
    score,
    total,
    date: new Date().toISOString(),
  };
}

export function mergeHiScore(
  board: TriviaHiScoreEntry[],
  entry: TriviaHiScoreEntry
): TriviaHiScoreEntry[] {
  return sortHiScores([...board, entry]);
}

export function qualifiesForHiScores(
  score: number,
  board: TriviaHiScoreEntry[]
): boolean {
  if (board.length < TRIVIA_LEADERBOARD_SIZE) return true;
  const lowest = board[board.length - 1]?.score ?? 0;
  return score >= lowest;
}

/** Validate initials for API / picker (A–Z, space, !, ?). */
export function isValidHiScoreInitials(initials: string): boolean {
  const t = initials.trim();
  if (t.length < 1 || t.length > 3) return false;
  return /^[A-Z!? ]+$/i.test(t);
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
