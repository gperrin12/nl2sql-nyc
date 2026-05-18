import Anthropic from "@anthropic-ai/sdk";
import type { ReplayResult } from "@/lib/replay";
import type { VizType } from "@/lib/viz-infer";
import {
  classifyQuestion,
  type QueryCategory,
} from "@/lib/query-category";

export type { QueryCategory } from "@/lib/query-category";
export { classifyQuestion } from "@/lib/query-category";

const client = new Anthropic();
const JUDGE_MODEL = "claude-sonnet-4-5";

const JUDGE_SYSTEM = `You are an expert evaluator for a natural language to SQL system that queries a NYC civic data warehouse using AWS Athena (Trino dialect).

You will be given a natural language question and the SQL that was generated for it. Evaluate the SQL on four dimensions and respond with JSON only — no prose, no code fences.`;

export type JudgeResult = {
  question: string;
  sql: string;
  category: QueryCategory;
  scores: {
    validity: number;
    intent: number;
    compliance: number;
    efficiency: number;
  };
  overall: number;
  issues: string[];
  verdict: "good" | "acceptable" | "poor";
  judgedAt: string;
};

export type ResultEval = {
  rowCount: number | null;
  emptyResult: boolean;
  vizType: VizType | null;
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

function buildUserMessage(question: string, sql: string): string {
  return `QUESTION: ${question}

GENERATED SQL:
${sql}

KEY RULES this SQL must follow:
1. Partitioned tables (gtp_tlc_data, nypd_collisions, nyc_311) must filter by year and month. Partition columns are VARCHAR — use quoted literals like year = '2024'.
2. VARCHAR columns must be cast before numeric operations: TRY_CAST(latitude AS DOUBLE), TRY_CAST(total_amount AS DOUBLE), etc.
3. Raw lat/lon columns only exist on nypd_collisions, nyc_311, and par — NOT on gtp_tlc_data or taxi_zones.
4. ST_Point takes (longitude, latitude) — X then Y. Never swap.
5. census_tracts joins census_tract_demographics ONLY on geoid. Never on borough name or tract label.
6. TLC zone IDs (pulocationid/dolocationid/locationid): never TRIM() — often integer; use IS NOT NULL and CAST/TRY_CAST both sides of joins to the same type. TRIM(pulocationid) <> '' is invalid.
7. nyc_311.borough is UPPERCASE ('BROOKLYN'). census_tracts.boroname is Title Case ('Brooklyn'). Never equate directly.
8. ACS measure columns are STRING — use TRY_CAST(TRIM(REGEXP_REPLACE(col, ',', '')) AS DOUBLE) for math.
9. Never SUBSTRING on timestamp/datetime columns — use day_of_week() for weekday vs weekend (Trino weekend = days 6–7).

Respond with this JSON structure:
{
  "scores": {
    "validity": <0-10>,
    "intent": <0-10>,
    "compliance": <0-10>,
    "efficiency": <0-10>
  },
  "overall": <0-10>,
  "issues": ["<specific problem 1>", "<specific problem 2>"],
  "verdict": "<good|acceptable|poor>"
}

verdict must be: "good" if overall >= 8, "acceptable" if overall 5-7, "poor" if overall <= 4.
issues should be an empty array if none found.`;
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
  scores?: {
    validity?: number;
    intent?: number;
    compliance?: number;
    efficiency?: number;
  };
  overall?: number;
  issues?: string[];
  verdict?: string;
};

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(10, Math.round(v * 10) / 10));
}

function verdictFromOverall(overall: number): "good" | "acceptable" | "poor" {
  if (overall >= 8) return "good";
  if (overall <= 4) return "poor";
  return "acceptable";
}

function parseJudgeResponse(
  question: string,
  sql: string,
  category: QueryCategory,
  text: string
): JudgeResult {
  const judgedAt = new Date().toISOString();
  try {
    const parsed = JSON.parse(extractJsonText(text)) as ParsedJudgeBody;
    const scores = {
      validity: clampScore(parsed.scores?.validity),
      intent: clampScore(parsed.scores?.intent),
      compliance: clampScore(parsed.scores?.compliance),
      efficiency: clampScore(parsed.scores?.efficiency),
    };
    const overall = clampScore(parsed.overall);
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.filter((i): i is string => typeof i === "string")
      : [];
    const verdict =
      parsed.verdict === "good" ||
      parsed.verdict === "acceptable" ||
      parsed.verdict === "poor"
        ? parsed.verdict
        : verdictFromOverall(overall);

    return {
      question,
      sql,
      category,
      scores,
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
      scores: { validity: 0, intent: 0, compliance: 0, efficiency: 0 },
      overall: 0,
      issues: ["judge parse error — could not parse model response"],
      verdict: "poor",
      judgedAt,
    };
  }
}

export async function judgeQueryPair(
  question: string,
  sql: string
): Promise<JudgeResult> {
  const category = classifyQuestion(question);

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1024,
    system: JUDGE_SYSTEM,
    messages: [{ role: "user", content: buildUserMessage(question, sql) }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return parseJudgeResponse(question, sql, category, text);
}

function buildResultUserMessage(
  question: string,
  sql: string,
  replay: ReplayResult
): string {
  const sqlBlock = buildUserMessage(question, sql);
  const columnsStr =
    replay.columns?.length ? replay.columns.join(", ") : "(none)";
  const sampleStr = replay.sampleRows?.length
    ? JSON.stringify(replay.sampleRows, null, 2)
    : "(none)";
  const vizStr = replay.vizType ?? "unknown";
  const emptyStr = replay.emptyResult ? "yes" : "no";
  const errorLine =
    replay.athenaStatus === "FAILED" ||
    replay.athenaStatus === "ERROR" ||
    replay.athenaStatus === "TIMEOUT"
      ? `\n- Error: ${replay.errorReason ?? replay.athenaStatus}`
      : "";

  return `${sqlBlock}

ATHENA EXECUTION RESULT:
- Status: ${replay.athenaStatus}
- Row count: ${replay.rowCount ?? "n/a"}
- Columns: ${columnsStr}
- Sample rows (first 5):
${sampleStr}
- Inferred visualization: ${vizStr}
- Empty result: ${emptyStr}${errorLine}

Now evaluate two additional dimensions:

5. Result quality (0-10): Does the returned data actually answer the question?
   - 0 rows when rows are expected = 0
   - FAILED query = 0
   - Correct shape and meaningful values = 8-10
   - Partially correct (wrong columns, unexpected nulls) = 4-7

6. Visualization fit (0-10): Is ${vizStr} the right choice for this question?
   - Spatial question + map result = 10
   - Time-series question + chart = 10
   - Wrong viz type chosen = 3-5
   - Can't tell from data = 5

Respond with JSON only:
{
  "resultQuality": <0-10>,
  "vizFit": <0-10>,
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
      resultQuality: clampScore(parsed.resultQuality),
      vizFit: clampScore(parsed.vizFit),
      resultIssues: Array.isArray(parsed.resultIssues)
        ? parsed.resultIssues.filter((i): i is string => typeof i === "string")
        : [],
    };
  } catch {
    return {
      resultQuality: 0,
      vizFit: 5,
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
    overall: clampScore(overall),
    verdict: verdictFromOverall(overall),
    judgedAt,
    resultEval: {
      rowCount: replay.rowCount,
      emptyResult: replay.emptyResult,
      vizType: replay.vizType,
      athenaStatus: replay.athenaStatus,
      resultQuality: parsed.resultQuality,
      vizFit: parsed.vizFit,
      resultIssues: parsed.resultIssues,
    },
  };
}
