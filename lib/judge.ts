import type Anthropic from "@anthropic-ai/sdk";
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

const JUDGE_SUBMIT_TOOL: Anthropic.Tool = {
  name: "submit_evaluation",
  description: "Submit the SQL correctness evaluation.",
  input_schema: {
    type: "object",
    properties: {
      score: {
        type: "integer",
        description: "Integer 1-5 per rubric.",
      },
      verdict: {
        type: "string",
        enum: ["correct", "partial", "incorrect"],
      },
      reasoning: {
        type: "string",
        description: "Brief analysis (1-3 sentences, plain text, no quotes).",
      },
    },
    required: ["score", "verdict", "reasoning"],
  },
};

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
Call submit_evaluation with:
- score: integer 1-5 per rubric
- verdict: "correct" (4-5), "partial" (2-3), or "incorrect" (1)
- reasoning: 1-3 short sentences (plain text; no double-quote characters)`;
}

function parseJudgeToolInput(input: unknown): ParsedJudgeBody | null {
  if (!input || typeof input !== "object") return null;
  const body = input as ParsedJudgeBody;
  const score = body.score ?? body.overall;
  if (score == null) return null;
  return body;
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
  if (score >= 2) return "partial";
  return "incorrect";
}

function normalizeVerdict(
  verdict: string | undefined,
  score: number
): CorrectnessVerdict {
  if (
    verdict === "correct" ||
    verdict === "partial" ||
    verdict === "incorrect"
  ) {
    return verdict;
  }
  return scoreToVerdict(score);
}

function bodyToCorrectnessResult(body: ParsedJudgeBody): CorrectnessResult {
  const score = clampJudgeScore(body.score ?? body.overall);
  const reasoning =
    typeof body.reasoning === "string" ? body.reasoning.trim() : "";
  return {
    score,
    reasoning,
    verdict: normalizeVerdict(body.verdict, score),
    judgeModel: JUDGE_MODEL,
  };
}

/** Regex fallback when model returns prose/invalid JSON instead of tool input. */
function parseJudgeFieldsFromText(text: string): ParsedJudgeBody | null {
  const scoreMatch =
    text.match(/"score"\s*:\s*(\d+)/i) ?? text.match(/\bscore\s*[:=]\s*(\d+)/i);
  if (!scoreMatch) return null;

  const verdictMatch = text.match(
    /"verdict"\s*:\s*"(correct|partial|incorrect)"/i
  );

  let reasoning = "";
  const reasoningMatch = text.match(
    /"reasoning"\s*:\s*"((?:\\.|[^"\\])*)"/i
  );
  if (reasoningMatch) {
    try {
      reasoning = JSON.parse(`"${reasoningMatch[1]}"`) as string;
    } catch {
      reasoning = reasoningMatch[1].replace(/\\n/g, "\n").trim();
    }
  }

  return {
    score: Number(scoreMatch[1]),
    verdict: verdictMatch?.[1],
    reasoning,
  };
}

function parseCorrectnessFromText(text: string): CorrectnessResult | null {
  const regexBody = parseJudgeFieldsFromText(text);
  if (regexBody) {
    try {
      return bodyToCorrectnessResult(regexBody);
    } catch {
      /* fall through */
    }
  }

  try {
    return bodyToCorrectnessResult(
      JSON.parse(extractJsonText(text)) as ParsedJudgeBody
    );
  } catch {
    return null;
  }
}

function parseCorrectnessResult(
  text: string,
  toolInput: unknown
): CorrectnessResult {
  const fromTool = parseJudgeToolInput(toolInput);
  if (fromTool) {
    return bodyToCorrectnessResult(fromTool);
  }

  const fromText = parseCorrectnessFromText(text);
  if (fromText) return fromText;

  console.error("judge parse error: no tool input and text parse failed");
  return {
    score: 1,
    reasoning: "parse_error",
    verdict: "incorrect",
    judgeModel: JUDGE_MODEL,
  };
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
    max_tokens: 1024,
    temperature: 0,
    tools: [JUDGE_SUBMIT_TOOL],
    tool_choice: { type: "tool", name: "submit_evaluation" },
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

  const toolBlock = response.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === "submit_evaluation"
  );

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const correctness = parseCorrectnessResult(text, toolBlock?.input);
  return {
    question,
    sql,
    category,
    dataset,
    overall: correctness.score,
    issues: correctness.reasoning ? [correctness.reasoning] : [],
    verdict: correctness.verdict,
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
