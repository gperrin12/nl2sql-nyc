import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { renderTriviaSchemaForPrompt } from "@/lib/schemas";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const DEFAULT_TRIVIA_MODEL = "claude-3-5-haiku-20241022";

export const TRIVIA_CATEGORIES = [
  "borough comparison for 311 complaints",
  "top 311 complaint types in a specific borough",
  "collision counts or injuries by borough",
  "contributing factors or vehicle types in collisions",
  "yellow taxi trip counts or zones (year 2025)",
  "taxi fare or tip patterns (year 2025)",
  "taxi pickup/dropoff zones via taxi_zones",
  "census tract demographics vs complaints (ACS 2023 vintage)",
] as const;

const TriviaQuestionSchema = z.object({
  question: z.string().min(12).max(500),
  options: z.array(z.string().min(1).max(200)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  sql: z.string().min(20).max(12000),
  explanation: z.string().min(12).max(800),
  /** Column in SQL result whose value equals options[correctIndex] (e.g. answer_label, borough) */
  proofColumn: z.string().min(1).max(100).optional(),
});

export type TriviaQuestionPayload = z.infer<typeof TriviaQuestionSchema>;

const TRIVIA_SYSTEM = `You write pub-trivia multiple-choice questions for NYC open data. Every question MUST be answerable by running one Athena SQL query you provide.

OUTPUT — strict JSON only (no markdown, no code fences, no commentary). Keys:
- question: specific surprising question (name boroughs, years, metrics — not vague)
- options: exactly 4 strings; one is the answer the SQL result supports; three plausible distractors
- correctIndex: 0-3 index of the correct option
- sql: one SELECT or WITH for AWS Athena (Trino dialect)
- explanation: 1-2 sentences plain English tying the correct option to the data
- proofColumn: optional name of the result column that holds the winning answer text (must equal options[correctIndex] in at least one row)

ALLOWED TABLES ONLY: nyc_311, nypd_collisions, gtp_tlc_data, taxi_zones, census_tracts, census_tract_demographics.

SQL RULES (critical):
- Partitioned tables (gtp_tlc_data, nypd_collisions, nyc_311): always filter year (and month when practical). year/month are VARCHAR — use quoted literals (year = '2025').
- Yellow/green taxi (gtp_tlc_data): use year = '2025' (2023/2024 partitions may be empty in this warehouse).
- nyc_311 / nypd_collisions: prefer year = '2024' or year = '2025' with reasonable scope.
- LIMIT 4 rows only; trivia SQL must return a small proof table (fast scans).
- REQUIRED proof shape: include a VARCHAR column (alias proofColumn) whose value in the winning row exactly equals options[correctIndex] — e.g. SELECT borough AS answer_label, COUNT(*) AS complaint_count ... GROUP BY borough ORDER BY 2 DESC LIMIT 4, where answer_label for the top row is the correct option text. For numeric-only answers, SELECT CAST(the_number AS VARCHAR) AS answer_label so the value appears in results.
- options[correctIndex] text must match Athena output exactly (same spelling/casing as returned: BROOKLYN vs Brooklyn vs Manhattan).
- TRY_CAST for numeric math on VARCHAR columns; nyc_311.borough is UPPERCASE ('BROOKLYN'); taxi_zones.borough is Title Case ('Manhattan').
- TLC joins: TRY_CAST(pulocationid AS BIGINT) = TRY_CAST(locationid AS BIGINT); never TRIM(locationid).
- Never SUBSTRING on timestamp columns — use day_of_week() for weekday/weekend.
- No DDL/DML.

DESIGN:
- correctIndex MUST be the option that matches the row with the HIGHEST numeric metric in your SQL result (not merely any row that appears). After ORDER BY metric DESC, the first row's answer_label must equal options[correctIndex].
- Distractors should be real NYC boroughs, zones, or plausible numbers — not joke answers.
- Questions should feel like bar trivia: comparative, top-N, surprising rankings.

SCHEMA:
${renderTriviaSchemaForPrompt()}`;

function pickCategory(): (typeof TRIVIA_CATEGORIES)[number] {
  return TRIVIA_CATEGORIES[Math.floor(Math.random() * TRIVIA_CATEGORIES.length)];
}

function parseTriviaJson(text: string): TriviaQuestionPayload {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const parsed = JSON.parse(raw) as unknown;
  return TriviaQuestionSchema.parse(parsed);
}

export async function generateTriviaQuestion(options?: {
  category?: string;
  feedback?: string;
  previousSql?: string;
}): Promise<TriviaQuestionPayload & { model: string }> {
  const model =
    process.env.TRIVIA_CLAUDE_MODEL ??
    process.env.CLAUDE_MODEL ??
    DEFAULT_TRIVIA_MODEL;
  const category = options?.category ?? pickCategory();

  let userContent = `Category focus: ${category}\n\nGenerate one new trivia question JSON.`;
  if (options?.feedback) {
    userContent +=
      `\n\nPrevious SQL failed or was rejected:\n${options.previousSql ?? "(none)"}\n\nFeedback:\n${options.feedback}\n\nGenerate a different question with corrected SQL.`;
  }

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: TRIVIA_SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  try {
    const payload = parseTriviaJson(textBlock.text);
    return { ...payload, model };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid trivia JSON from model: ${detail}`);
  }
}
