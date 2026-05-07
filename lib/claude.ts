import Anthropic from "@anthropic-ai/sdk";
import { renderSchemaForPrompt } from "./schemas";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_MODEL = "claude-sonnet-4-5";

const SYSTEM_PROMPT = `You translate natural-language questions into AWS Athena SQL (Trino dialect) for a NYC civic-data warehouse.

OUTPUT FORMAT — strict:
Respond with a single SQL query, no prose, no code fences, no commentary.
The query must be a single SELECT or WITH statement. No DDL, DML, or multi-statement scripts.

RULES:
1. Always include LIMIT 1000 unless the user explicitly asks for a different limit.
2. Always filter partitioned tables (gtp_tlc_data, nypd_collisions, nyc_311) by year and month when possible. Unfiltered queries are extremely expensive. Partition columns year/month are VARCHAR: compare with quoted literals (year = '2025'), not bare integers.
3. Many columns are STRING/VARCHAR in Athena. Before BETWEEN, ORDER BY numerically, SUM/AVG, ST_POINT, or comparisons to numbers/dates, wrap with TRY_CAST(...) / TRY(...) as appropriate. VARCHAR BETWEEN double AND double is invalid — cast the column first.
4. For spatial joins use ST_GEOMETRY_FROM_TEXT(geometry_wkt) and ST_POINT(TRY_CAST(longitude AS DOUBLE), TRY_CAST(latitude AS DOUBLE)) (or CAST after NULL checks).
5. NYC bounds on raw lat/lon: TRY_CAST(latitude AS DOUBLE) BETWEEN 40.4 AND 41.0 AND TRY_CAST(longitude AS DOUBLE) BETWEEN -74.3 AND -73.6. Never put uncast latitude/longitude in numeric BETWEEN.
6. nyc_311.borough is UPPERCASE ('BROOKLYN'); census_tracts.boroname is Title Case ('Brooklyn'). Don't equate them as strings — spatial join via lat/lon if you need to bridge.
7. ACS demographics live in census_tract_demographics with _2018 and _2023 suffixes. Rates are not pre-computed. Use FROM_ISO8601_TIMESTAMP() for ISO date strings in nyc_311.

SCHEMA:
${renderSchemaForPrompt()}`;

export type SqlGenerationResult = {
  sql: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export async function generateSql(question: string): Promise<SqlGenerationResult> {
  const model = process.env.CLAUDE_MODEL ?? DEFAULT_MODEL;

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: question }],
  });

  // Extract text from the first text block.
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  const sql = stripCodeFences(textBlock.text).trim();
  return {
    sql,
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/** Defensive: in case the model wraps SQL in ```sql ... ``` despite the prompt. */
function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1] : text;
}
