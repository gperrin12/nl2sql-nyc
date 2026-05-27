import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_DETERMINISTIC_SAMPLING } from "@/lib/claude";
import type { ReplayResult } from "@/lib/replay";
import type { VizType } from "@/lib/viz-infer";
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

const client = new Anthropic();
const JUDGE_MODEL = "claude-haiku-4-5";

const JUDGE_SYSTEM = `You are an expert evaluator for a natural language to SQL system that queries a NYC civic data warehouse using AWS Athena (Trino dialect).

You will be given a natural language question, generated SQL, and execution context. Follow the requested rubric and respond with JSON only — no code fences.`;

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

export type ResultEval = {
  rowCount: number | null;
  emptyResult: boolean;
  vizType: VizType | null;
  /** What ResultsPanel renders (map/chart/table), from inferUiViz. */
  uiVizDescription?: string | null;
  athenaStatus: string;
  resultQuality: number;
  vizFit: number;
  resultIssues: string[];
};

export type FullJudgeResult = JudgeResult & {
  /** SQL-only overall before full-eval blend; equals overall when no resultEval. */
  sqlOverall?: number;
  resultEval?: ResultEval;
};

import { blendJudgeOverall } from "@/lib/judge-blend";

export { JUDGE_BLEND_COEFF, JUDGE_BLEND_DIVISOR } from "@/lib/judge-blend";

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
    ? `Execution: SUCCESS - returned ${executionContext.rowCount ?? "unknown"} row(s)`
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

function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
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

function clampResultScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(5, Math.round(v)));
}

function verdictFromOverall(overall: number): CorrectnessVerdict {
  if (overall >= 4) return "correct";
  if (overall <= 2) return "incorrect";
  return "partial";
}

function parseJudgeResponse(
  question: string,
  sql: string,
  category: QueryCategory,
  dataset: QueryDataset,
  text: string
): JudgeResult {
  const judgedAt = new Date().toISOString();
  try {
    const parsed = JSON.parse(extractJsonText(text)) as ParsedJudgeBody;
    const overall = clampJudgeScore(parsed.score ?? parsed.overall);
    const issuesFromArray = Array.isArray(parsed.issues)
      ? parsed.issues.filter((i): i is string => typeof i === "string")
      : [];
    const reasoning =
      typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "";
    const issues =
      issuesFromArray.length > 0
        ? issuesFromArray
        : reasoning
          ? [reasoning]
          : [];
    const verdict =
      parsed.verdict === "correct" ||
      parsed.verdict === "partial" ||
      parsed.verdict === "incorrect"
        ? parsed.verdict
        : verdictFromOverall(overall);

    return {
      question,
      sql,
      category,
      dataset,
      overall,
      issues,
      verdict,
      judgedAt,
    };
  } catch {
    return {
      question,
      sql,
      category,
      dataset,
      overall: 1,
      issues: ["judge parse error — could not parse model response"],
      verdict: "incorrect",
      judgedAt,
    };
  }
}

export async function judgeQueryPair(
  question: string,
  sql: string
): Promise<JudgeResult> {
  const category = classifyQuestion(question);
  const dataset = detectDatasets(sql);

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1024,
    ...CLAUDE_DETERMINISTIC_SAMPLING,
    system: JUDGE_SYSTEM,
    messages: [
      {
        role: "user",
        content: buildJudgePrompt(question, sql, {
          success: true,
          rowCount: null,
          errorMessage: null,
          sampleRows: null,
        }),
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return parseJudgeResponse(question, sql, category, dataset, text);
}

function buildResultUserMessage(
  question: string,
  sql: string,
  replay: ReplayResult
): string {
  const sqlBlock = buildJudgePrompt(question, sql, {
    success: replay.athenaStatus === "SUCCEEDED",
    rowCount: replay.rowCount,
    errorMessage: replay.errorReason ?? replay.athenaStatus,
    sampleRows: replay.sampleRows,
  });

  return `${sqlBlock}

Now evaluate two additional dimensions:

5. Result quality (1-5): Does the returned data actually answer the question?
   - 0 rows when rows are expected = 1
   - FAILED query = 1
   - Correct shape and meaningful values = 5
   - Partially correct (wrong columns, unexpected nulls) = 2-4

6. Visualization fit (1-5): Does the app's presentation above match this question?
   - Spatial / H3 / heatmap / "where" / map questions + map (including H3 hex choropleth) = 5
   - The app always shows a results table too; do not penalize an accompanying table when a map or chart is present
   - Time-series question + chart = 5
   - Only table when a map or chart was clearly needed = 2-3
   - Can't tell from data = 3

Respond with JSON only:
{
  "resultQuality": <1-5>,
  "vizFit": <1-5>,
  "resultIssues": ["issue 1", "issue 2"]
}`;
}

type ParsedResultBody = {
  resultQuality?: number;
  vizFit?: number;
  resultIssues?: string[];
};

function parseResultJudgeResponse(text: string): {
  resultQuality: number;
  vizFit: number;
  resultIssues: string[];
} {
  try {
    const parsed = JSON.parse(extractJsonText(text)) as ParsedResultBody;
    return {
      resultQuality: clampResultScore(parsed.resultQuality),
      vizFit: clampResultScore(parsed.vizFit),
      resultIssues: Array.isArray(parsed.resultIssues)
        ? parsed.resultIssues.filter((i): i is string => typeof i === "string")
        : [],
    };
  } catch {
    return {
      resultQuality: 1,
      vizFit: 3,
      resultIssues: ["result judge parse error"],
    };
  }
}

export async function judgeFullResult(
  question: string,
  sql: string,
  replay: ReplayResult
): Promise<FullJudgeResult> {
  const sqlEval = await judgeQueryPair(question, sql);
  const judgedAt = new Date().toISOString();

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1024,
    ...CLAUDE_DETERMINISTIC_SAMPLING,
    system: JUDGE_SYSTEM,
    messages: [
      { role: "user", content: buildResultUserMessage(question, sql, replay) },
    ],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = parseResultJudgeResponse(text);
  const overall = blendJudgeOverall(
    sqlEval.overall,
    parsed.resultQuality,
    parsed.vizFit
  );

  return {
    ...sqlEval,
    sqlOverall: sqlEval.overall,
    overall: clampJudgeScore(overall),
    verdict: verdictFromOverall(overall),
    judgedAt,
    resultEval: {
      rowCount: replay.rowCount,
      emptyResult: replay.emptyResult,
      vizType: replay.vizType,
      uiVizDescription: replay.uiVizDescription,
      athenaStatus: replay.athenaStatus,
      resultQuality: parsed.resultQuality,
      vizFit: parsed.vizFit,
      resultIssues: parsed.resultIssues,
    },
  };
}
