import type { ReplayResult } from "@/lib/replay";
import { getAnthropicClient } from "@/lib/anthropic-client";
import {
  classifyQuestion,
  type QueryCategory,
} from "@/lib/query-category";
import { detectDatasets, type QueryDataset } from "@/lib/query-dataset";

export type { QueryCategory } from "@/lib/query-category";
export { classifyQuestion } from "@/lib/query-category";
export type { QueryDataset } from "@/lib/query-dataset";
export { detectDatasets, resolveEvalDataset } from "@/lib/query-dataset";

export type CorrectnessVerdict = "correct" | "partial" | "incorrect";

const JUDGE_MODEL = "claude-haiku-4-5";

export type JudgeResult = {
  question: string;
  sql: string;
  category: QueryCategory;
  dataset: QueryDataset;
  overall: number;
  issues: string[];
  verdict: CorrectnessVerdict;
  judgedAt: string;
};
export type FullJudgeResult = JudgeResult;
type CorrectnessResult = {
  score: number;
  reasoning: string;
  verdict: CorrectnessVerdict;
  judgeModel: string;
};

const CORRECTNESS_SCALE_CRITERIA = `
Score 5 - Correct: The SQL directly and completely answers the question asked.
           Uses the correct table(s), correct filters, correct aggregation, and
           appropriate result format. A human reviewing the query would not change anything.

Score 4 - Mostly correct: Minor issue that doesn't materially change the answer.
           Examples: slightly different column alias, extra column returned, OR condition
           where AND was needed but results are still substantially correct.

Score 3 - Partially correct: Right general approach, wrong specific detail.
           Gets the right tables but wrong filter value, or right aggregation but
           wrong time range, or right intent but missing a required JOIN.
           The query runs and returns data but the data is not fully reliable.

Score 2 - Mostly wrong: Attempts to answer but contains a fundamental error that
           makes the result misleading or incorrect.
           Examples: wrong table, critical missing filter, wrong aggregation type
           (SUM instead of COUNT, or vice versa in a context where it matters).

Score 1 - Incorrect: Does not answer the question.
           Either failed to execute entirely, references nonexistent tables/columns,
           or performs a completely different operation than what was requested.
`.trim();

type ExecutionContext = {
  success: boolean;
  rowCount?: number | null;
  errorMessage?: string | null;
  sampleRows?: unknown[] | null;
};

function buildJudgePrompt(
  question: string,
  generatedSql: string,
  executionContext: ExecutionContext
): string {
  const execSummary = executionContext.success
    ? `Execution: SUCCESS - returned ${executionContext.rowCount ?? "unknown"} row(s)${
        executionContext.rowCount === 0 ? " (empty result)" : ""
      }`
    : `Execution: FAILED - ${executionContext.errorMessage ?? "unknown error"}`;

  const sampleRows = Array.isArray(executionContext.sampleRows)
    ? executionContext.sampleRows
    : [];
  const sampleRowsSection =
    sampleRows.length > 0
      ? `\nSample result rows (first ${Math.min(3, sampleRows.length)}):\n${JSON.stringify(sampleRows.slice(0, 3), null, 2)}`
      : "";

  return `You are an expert evaluator for an NL-to-SQL system that queries NYC civic data in AWS Athena (Trino dialect).

Your task: evaluate how well the generated SQL answers the natural language question.

QUESTION ASKED:
${question}

GENERATED SQL:
${generatedSql}

EXECUTION RESULT:
${execSummary}${sampleRowsSection}

SCORING RUBRIC:
${CORRECTNESS_SCALE_CRITERIA}

INSTRUCTIONS:
1. First, write your reasoning: analyze the SQL against the question. Consider whether the correct tables, filters, aggregations, and joins were used.
2. Then, assign a score from 1 to 5 using the rubric above.
3. Then, assign a verdict: "correct" (score 4-5), "partial" (score 2-3), or "incorrect" (score 1).

Respond with JSON only - no prose, no code fences, no commentary.
Format: {"reasoning": "your analysis here", "score": N, "verdict": "correct|partial|incorrect"}`;
}

/** First balanced `{...}` object (respects strings) — avoids lastIndexOf on nested `}`. */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function extractJsonText(raw: string): string {
  let text = raw.trim();

  // Closed markdown fence
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fenced) text = fenced[1].trim();

  // Opening fence without closing (common Haiku slip)
  if (/^```(?:json)?/i.test(text)) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  }

  const object = extractFirstJsonObject(text);
  if (object) return object;

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);

  return text;
}

type ParsedJudgeBody = {
  score?: number;
  overall?: number;
  reasoning?: string;
  issues?: string[];
  verdict?: string;
};

function clampJudgeScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(5, Math.round(v)));
}

function scoreToVerdict(score: number): CorrectnessVerdict {
  if (score >= 4) return "correct";
  if (score === 3) return "partial";
  return "incorrect";
}

function parseCorrectnessResult(text: string): CorrectnessResult {
  try {
    const parsed = JSON.parse(extractJsonText(text)) as ParsedJudgeBody;
    const score = clampJudgeScore(parsed.score ?? parsed.overall);
    const reasoning =
      typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "";
    const verdict =
      parsed.verdict === "correct" ||
      parsed.verdict === "partial" ||
      parsed.verdict === "incorrect"
        ? parsed.verdict
        : scoreToVerdict(score);
    return { score, reasoning, verdict, judgeModel: JUDGE_MODEL };
  } catch (error) {
    console.error("judge parse error", error);
    return {
      score: 1,
      reasoning: "parse_error",
      verdict: "incorrect",
      judgeModel: JUDGE_MODEL,
    };
  }
}

export async function judgeQueryPair(
  question: string,
  sql: string,
  executionContext?: ExecutionContext
): Promise<JudgeResult> {
  const category = classifyQuestion(question);
  const dataset = detectDatasets(sql);

  const response = await getAnthropicClient().messages.create({
    model: JUDGE_MODEL,
    max_tokens: 512,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: buildJudgePrompt(question, sql, {
          success: executionContext?.success ?? true,
          rowCount: executionContext?.rowCount ?? null,
          errorMessage: executionContext?.errorMessage ?? null,
          sampleRows: executionContext?.sampleRows ?? null,
        }),
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const correctness = parseCorrectnessResult(text);
  return {
    question,
    sql,
    category,
    dataset,
    overall: correctness.score,
    issues: correctness.reasoning ? [correctness.reasoning] : [],
    verdict: scoreToVerdict(correctness.score),
    judgedAt: new Date().toISOString(),
  };
}

export async function judgeFullResult(
  question: string,
  sql: string,
  replay: ReplayResult
): Promise<FullJudgeResult> {
  return judgeQueryPair(question, sql, {
    success: replay.athenaStatus === "SUCCEEDED",
    rowCount: replay.rowCount,
    errorMessage: replay.errorReason ?? replay.athenaStatus,
    sampleRows: replay.sampleRows,
  });
}
