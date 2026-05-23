/**
 * Client-side trivia score persistence (localStorage).
 * Structured for a future leaderboard API — same shape can be posted per player.
 */

export const TRIVIA_SCORE_STORAGE_KEY = "nl2sql-nyc-trivia-score";

/** Current session stats for one browser / player. */
export type TriviaScoreRecord = {
  correct: number;
  answered: number;
  bestStreak: number;
  currentStreak: number;
  updatedAt: string;
};

/** Future hi-score row (friends leaderboard). */
export type TriviaLeaderboardEntry = {
  playerId: string;
  displayName: string;
  correct: number;
  answered: number;
  accuracy: number;
  bestStreak: number;
  updatedAt: string;
};

const DEFAULT_SCORE: TriviaScoreRecord = {
  correct: 0,
  answered: 0,
  bestStreak: 0,
  currentStreak: 0,
  updatedAt: new Date(0).toISOString(),
};

function isScoreRecord(value: unknown): value is TriviaScoreRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.correct === "number" &&
    typeof r.answered === "number" &&
    typeof r.bestStreak === "number" &&
    typeof r.currentStreak === "number" &&
    typeof r.updatedAt === "string"
  );
}

export function loadTriviaScore(): TriviaScoreRecord {
  if (typeof window === "undefined") return { ...DEFAULT_SCORE };
  try {
    const raw = localStorage.getItem(TRIVIA_SCORE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SCORE };
    const parsed: unknown = JSON.parse(raw);
    if (!isScoreRecord(parsed)) return { ...DEFAULT_SCORE };
    return parsed;
  } catch {
    return { ...DEFAULT_SCORE };
  }
}

export function saveTriviaScore(record: TriviaScoreRecord): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TRIVIA_SCORE_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Quota or private mode — ignore
  }
}

export function recordTriviaAnswer(
  prev: TriviaScoreRecord,
  wasCorrect: boolean
): TriviaScoreRecord {
  const currentStreak = wasCorrect ? prev.currentStreak + 1 : 0;
  const next: TriviaScoreRecord = {
    correct: prev.correct + (wasCorrect ? 1 : 0),
    answered: prev.answered + 1,
    currentStreak,
    bestStreak: Math.max(prev.bestStreak, currentStreak),
    updatedAt: new Date().toISOString(),
  };
  saveTriviaScore(next);
  return next;
}

export function triviaAccuracy(record: TriviaScoreRecord): number | null {
  if (record.answered === 0) return null;
  return record.correct / record.answered;
}

/** Map local record → future API leaderboard payload. */
export function toLeaderboardEntry(
  record: TriviaScoreRecord,
  playerId: string,
  displayName: string
): TriviaLeaderboardEntry {
  const accuracy = triviaAccuracy(record) ?? 0;
  return {
    playerId,
    displayName,
    correct: record.correct,
    answered: record.answered,
    accuracy,
    bestStreak: record.bestStreak,
    updatedAt: record.updatedAt,
  };
}
