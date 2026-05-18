/**
 * Trivia hi-score types and merge/sort helpers (client + server).
 * Persistence: S3 via lib/trivia-hiscores-store.ts and /api/trivia/hiscores.
 */

export const TRIVIA_SESSION_LENGTH = 10;
export const TRIVIA_LEADERBOARD_SIZE = 10;
/** Max characters on the SNES-style name entry screen. */
export const HISCORE_NAME_MAX_LENGTH = 8;

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

/** Stored in `initials` for backward compatibility with existing S3 JSON. */
export function normalizeHiScoreName(name: string): string {
  return name.trim().toUpperCase().slice(0, HISCORE_NAME_MAX_LENGTH);
}

export function formatHiScoreName(stored: string): string {
  return stored.trim() || "—";
}

export function buildHiScoreEntry(
  name: string,
  score: number,
  total: number = TRIVIA_SESSION_LENGTH
): TriviaHiScoreEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    initials: normalizeHiScoreName(name),
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

/** Validate name for API / picker. */
export function isValidHiScoreName(name: string): boolean {
  const t = name.trim();
  if (t.length < 1 || t.length > HISCORE_NAME_MAX_LENGTH) return false;
  return /^[A-Z0-9 '-]+$/i.test(t);
}

/** @deprecated Use isValidHiScoreName */
export const isValidHiScoreInitials = isValidHiScoreName;

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
