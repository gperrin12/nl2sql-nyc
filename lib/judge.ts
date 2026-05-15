import Anthropic from "@anthropic-ai/sdk";
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
6. TLC location IDs (pulocationid/dolocationid) are VARCHAR — always cast both sides of joins to the same type.
7. nyc_311.borough is UPPERCASE ('BROOKLYN'). census_tracts.boroname is Title Case ('Brooklyn'). Never equate directly.
8. ACS measure columns are STRING — use TRY_CAST(TRIM(REGEXP_REPLACE(col, ',', '')) AS DOUBLE) for math.

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
