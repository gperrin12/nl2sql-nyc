import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CLAUDE_DETERMINISTIC_SAMPLING } from "@/lib/claude";
import { renderTriviaSchemaForPrompt } from "@/lib/schemas";
import {
  getCategoryGenerationHint,
  pickCategoryForRequest,
  type TriviaSessionConstraints,
} from "@/lib/trivia-categories";
import {
  TLC_TRIP_FILTER_PROMPT_RULE,
  TLC_ZONE_MIN_PICKUPS_PROMPT_RULE,
} from "@/lib/tlc-trip-filters";
import { extractJsonText } from "@/lib/extract-json-text";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// claude-3-5-haiku-20241022 was retired by Anthropic on 2026-02-19; claude-haiku-4-5
// (alias for claude-haiku-4-5-20251001) is the current replacement.
const DEFAULT_TRIVIA_MODEL = "claude-haiku-4-5";

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

/** Thrown on generation/parse failure; carries usage so failed attempts still count toward cost tracking. */
export class TriviaGenerationError extends Error {
  usage: { inputTokens: number; outputTokens: number };
  constructor(
    message: string,
    usage: { inputTokens: number; outputTokens: number }
  ) {
    super(message);
    this.name = "TriviaGenerationError";
    this.usage = usage;
  }
}

const TRIVIA_SYSTEM = `You write pub-trivia multiple-choice questions for NYC open data. Every question MUST be answerable by running one Athena SQL query you provide.

OUTPUT — strict JSON only (no markdown, no code fences, no commentary). Keys:
- question: specific surprising question (name boroughs, years, metrics — not vague)
- options: exactly 4 strings
- correctIndex: 0-3 index of the correct option
- sql: one SELECT or WITH for AWS Athena (Trino dialect)
- explanation: 1-2 sentences that MUST name options[correctIndex] by name (same spelling) and describe why it wins — never explain a different option (e.g. do not write about JFK if the correct option is a neighborhood zone)
- proofColumn: name of the VARCHAR label column in SQL (usually answer_label)

OPTIONS ↔ SQL (mandatory workflow):
1. Design SQL first: SELECT <label> AS answer_label, <metric> ... ORDER BY metric DESC LIMIT 4.
2. The four options MUST be exactly the four answer_label values your SQL returns (same spelling/casing as Athena). Do not invent options (e.g. airport names) that are not rows in your result.
3. correctIndex points to whichever option equals the TOP row's answer_label after ORDER BY metric DESC.
4. The question text must ask about the same entities as answer_label (if SQL returns taxi zone names, options and question are about those zones).

ALLOWED TABLES ONLY: nyc_311, nypd_collisions, gtp_tlc_data, taxi_zones, census_tracts, census_tract_demographics, mta_turnstile.

SQL RULES (critical):
- Partitioned tables (gtp_tlc_data, nypd_collisions, nyc_311): always filter year (and month when practical). year/month are VARCHAR — use quoted literals (year = '2025').
- Yellow/green taxi (gtp_tlc_data): use year = '2025' (2023/2024 partitions may be empty in this warehouse). Required WHERE on trips: trip_distance > 0 AND <= 50 miles, pulocationid/dolocationid NOT NULL, fare_amount between 0 and 500.
- nyc_311 / nypd_collisions: prefer year = '2024' or year = '2025' with reasonable scope.
- LIMIT 4 rows only; trivia SQL must return a small proof table (fast scans).
- REQUIRED proof shape: include a VARCHAR column (alias proofColumn) whose value in the winning row exactly equals options[correctIndex] — e.g. SELECT borough AS answer_label, COUNT(*) AS complaint_count ... GROUP BY borough ORDER BY 2 DESC LIMIT 4, where answer_label for the top row is the correct option text. For numeric-only answers, SELECT CAST(the_number AS VARCHAR) AS answer_label so the value appears in results.
- options[correctIndex] text must match Athena output exactly (same spelling/casing as returned: BROOKLYN vs Brooklyn vs Manhattan).
- TRY_CAST for numeric math on VARCHAR columns; nyc_311.borough is UPPERCASE ('BROOKLYN'); taxi_zones.borough is Title Case ('Manhattan').
- TLC joins: TRY_CAST(pulocationid AS BIGINT) = TRY_CAST(locationid AS BIGINT); never TRIM(locationid).
- Never SUBSTRING on timestamp columns — use day_of_week() for weekday/weekend.
- ${TLC_TRIP_FILTER_PROMPT_RULE}
- ${TLC_ZONE_MIN_PICKUPS_PROMPT_RULE}
- No DDL/DML.

REAL-WORLD SENSE (mandatory — trivial SQL is not enough):
- Ask questions a NYC policy nerd would recognize as meaningful: "which borough had the most X in 2024?", "which zone had the highest average fare?", "top contributing factor for injury collisions".
- DISALLOWED: spurious cross-dataset rates or ratios — e.g. 311 complaints per collision, noise complaints per crash, taxi trips per complaint, combining 311 + collisions + taxi in one "per" or "ratio" question. These are not interpretable civic metrics.
- ALLOWED cross-data: per-capita 311 or collisions using census population (clearly say per capita / per 1,000 residents). census_tract_demographics + one fact table only.
- One primary dataset per question; SQL should mainly aggregate ONE fact table (optional dimension join to taxi_zones or census for labels/denominators).

DESIGN:
- DIRECTION: only ask "highest / most / top / largest / busiest / longest / slowest" style questions where the answer is the row with the MAX metric. NEVER ask for the lowest/least/fewest/smallest/fastest/shortest — the answer is always the HIGHEST-metric row after ORDER BY metric DESC, and a minimum question would be scored wrong.
- correctIndex MUST be the option that matches the row with the HIGHEST numeric metric in your SQL result (not merely any row that appears). After ORDER BY metric DESC, the first row's answer_label must equal options[correctIndex].
- Ranking questions MUST have exactly ONE winner in the proof result: no two rows with the same top metric and different answer_label values. Use LIMIT 1 after ORDER BY, or a tie-break column (e.g. borough ASC). ACS median income is often top-coded at 250001 — avoid questions where Manhattan and Brooklyn (or others) tie at that cap; pick another metric, tract-level filter, or comparison where one option uniquely wins.
- Distractors should be real NYC boroughs, zones, or plausible numbers — not joke answers.
- Questions should feel like bar trivia: comparative, top-N, surprising rankings — not academic novelty ratios.

SCHEMA:
${renderTriviaSchemaForPrompt()}`;

function parseTriviaJson(text: string): TriviaQuestionPayload {
  const raw = extractJsonText(text);
  const parsed = JSON.parse(raw) as unknown;
  return TriviaQuestionSchema.parse(parsed);
}

function buildUserPrompt(
  categoryLabel: string,
  categoryId: string,
  constraints?: TriviaSessionConstraints
): string {
  let content = `Category focus (required): ${categoryLabel}\nCategory id: ${categoryId}\n\nGenerate one new trivia question JSON for this category only.`;
  const hint = getCategoryGenerationHint(categoryId);
  if (hint) content += `\n\nCategory-specific rule:\n${hint}`;

  if (constraints?.usedFamilies?.length) {
    content += `\n\nThis 10-question session already used these topic families: ${constraints.usedFamilies.join(", ")}. Stay within your assigned category but use a fresh angle (different metric, borough, year, or ranking).`;
  }

  if (constraints?.excludeQuestions?.length) {
    content +=
      "\n\nDo NOT repeat or closely paraphrase any of these earlier questions in this session:";
    for (const q of constraints.excludeQuestions) {
      content += `\n- ${q.slice(0, 220)}`;
    }
  }

  return content;
}

/** Resolved trivia model (same fallback chain used inside generateTriviaQuestion), for cost logging when generation fails before a response is returned. */
export function getTriviaModel(): string {
  return (
    process.env.TRIVIA_CLAUDE_MODEL ??
    process.env.CLAUDE_MODEL ??
    DEFAULT_TRIVIA_MODEL
  );
}

function isModelNotFoundError(e: unknown): boolean {
  if (e instanceof Anthropic.NotFoundError) return true;
  // Belt-and-suspenders: match by status in case the SDK's error class
  // hierarchy changes across versions.
  return (
    e instanceof Anthropic.APIError &&
    e.status === 404 &&
    /model/i.test(e.message)
  );
}

/**
 * Anthropic model IDs are pinned snapshots that eventually get retired (see
 * https://platform.claude.com/docs/en/about-claude/model-deprecations) — there is
 * no "always latest" alias to fall back on. A misconfigured/stale TRIVIA_CLAUDE_MODEL
 * or CLAUDE_MODEL env var (e.g. on a hosting provider that wasn't updated) would
 * otherwise silently fail every trivia generation with a 404. Retry once against
 * DEFAULT_TRIVIA_MODEL (the model this codebase ships and keeps current) so a
 * stale env var degrades gracefully instead of taking trivia down entirely.
 */
async function createTriviaCompletion(
  model: string,
  userContent: string
): Promise<{ response: Anthropic.Messages.Message; model: string }> {
  const request = (m: string) =>
    client.messages.create({
      model: m,
      max_tokens: 1024,
      ...CLAUDE_DETERMINISTIC_SAMPLING,
      temperature: 0,
      system: TRIVIA_SYSTEM,
      messages: [{ role: "user", content: userContent }],
    });

  try {
    return { response: await request(model), model };
  } catch (e) {
    if (!isModelNotFoundError(e) || model === DEFAULT_TRIVIA_MODEL) throw e;

    console.warn(
      `[trivia] model "${model}" returned 404 (likely retired/misconfigured) — ` +
        `retrying once with fallback "${DEFAULT_TRIVIA_MODEL}"`
    );
    return { response: await request(DEFAULT_TRIVIA_MODEL), model: DEFAULT_TRIVIA_MODEL };
  }
}

export async function generateTriviaQuestion(options?: {
  category?: string;
  categoryId?: string;
  session?: TriviaSessionConstraints;
  feedback?: string;
  previousSql?: string;
}): Promise<
  TriviaQuestionPayload & {
    model: string;
    categoryId: string;
    categoryLabel: string;
    usage: { inputTokens: number; outputTokens: number };
  }
> {
  const model = getTriviaModel();

  const sessionConstraints: TriviaSessionConstraints = {
    deck: options?.session?.deck,
    categoryId: options?.categoryId ?? options?.session?.categoryId,
    excludeQuestions: options?.session?.excludeQuestions,
    usedFamilies: options?.session?.usedFamilies,
  };

  const picked = pickCategoryForRequest(sessionConstraints);
  const categoryLabel = options?.category ?? picked.label;
  const categoryId = options?.categoryId ?? picked.id;

  let userContent = buildUserPrompt(categoryLabel, categoryId, sessionConstraints);
  if (options?.feedback) {
    userContent +=
      `\n\nPrevious SQL failed or was rejected:\n${options.previousSql ?? "(none)"}\n\nFeedback:\n${options.feedback}\n\nGenerate a different question with corrected SQL.`;
  }

  const { response, model: modelUsed } = await createTriviaCompletion(
    model,
    userContent
  );

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new TriviaGenerationError("Claude returned no text content", usage);
  }

  try {
    const payload = parseTriviaJson(textBlock.text);
    return { ...payload, model: modelUsed, categoryId, categoryLabel, usage };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new TriviaGenerationError(
      `Invalid trivia JSON from model: ${detail}`,
      usage
    );
  }
}
