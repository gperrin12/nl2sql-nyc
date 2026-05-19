import { sqlComplexity } from "@/lib/sql-metrics";

export type QueryDifficulty = "easy" | "medium" | "hard";

export const DIFFICULTY_LABELS: Record<QueryDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

/** SQL complexity score → difficulty (matches EvalSummary breakdown). */
export function difficultyFromComplexityScore(score: number): QueryDifficulty {
  if (score < 6) return "easy";
  if (score < 14) return "medium";
  return "hard";
}

export function difficultyFromSql(sql: string): QueryDifficulty | null {
  if (!sql?.trim()) return null;
  return difficultyFromComplexityScore(sqlComplexity(sql).score);
}
