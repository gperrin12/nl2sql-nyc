/** Stored in nl2sql.query_runs.judge_detail (client-safe type only). */

export type JudgeDetailVerdict = "correct" | "partial" | "incorrect";

export type JudgeDetail = {
  overall: number;
  verdict: JudgeDetailVerdict;
  reasoning: string;
  judgedAt: string;
  judgeModel?: string;
};
