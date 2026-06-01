import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "@/lib/anthropic-client";
import {
  addUsage,
  buildTokenSummary,
  computeCostUsd,
  createAccumulator,
  writeTokensToQueryRun,
} from "@/lib/query-run-tokens";
import {
  CLAUDE_DETERMINISTIC_SAMPLING,
  type SqlGenerationResult,
} from "@/lib/claude";
import { listWarehouseTableNames, renderTablesForPrompt } from "@/lib/schemas";
import { getProductionPromptVersion } from "@/lib/prompt-versions";
import type { AgentStreamPayload } from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-5";

export const MAX_AGENT_TURNS = 14;

const OBSERVE_PREVIEW_MAX = 1400;

const AGENT_SYSTEM = `You translate natural-language questions into AWS Athena SQL (Trino dialect) for a NYC civic-data warehouse.

You work in steps using tools:
1. Call list_tables if you need to see what tables exist.
2. Call get_schema for EVERY table you will reference in SQL before writing the query (pull only what you need — reduces hallucinated columns).
3. When schema is sufficient, send your FINAL reply in two parts: (A) One or two plain-English sentences describing what the result shows for the user (e.g. "Motor vehicle crashes in Bedford-Stuyvesant during 2024 as map points"). No markdown, no SQL in part A. (B) A blank line, then exactly ONE SQL statement starting with WITH or SELECT — no code fences before or after, no trailing commentary. Include LIMIT 1000 unless the user asks otherwise.

Before each batch of tool calls (not on the final SQL reply), write one short plain-English sentence about what you will do next — shown to the user in the UI.

Dialect rules (must still obey):
- Partitioned tables: filter year/month as VARCHAR ('2024'), not bare integers.
- Datetime: never SUBSTRING on timestamp columns — use day_of_week(FROM_ISO8601_TIMESTAMP(col)) or day_of_week(col) for weekday/weekend (Trino: weekend = IN (6,7)); tip % = 100 * tip/fare with TRY_CAST.
- VARCHAR vs numeric comparisons need TRY_CAST; NYC lat/lon bounds use TRY_CAST(... AS DOUBLE).
- TLC zone joins: align INTEGER/VARCHAR for locationid vs pulocationid; never TRIM(pulocationid/dolocationid/locationid) — use IS NOT NULL and CAST/TRY_CAST for joins (TRIM on integer causes FUNCTION_NOT_FOUND).
- gtp_tlc_data: TRY_CAST(trip_distance AS DOUBLE) > 0 AND <= 50 miles; fare_amount 0–500; or zone averages skew to 300+ mile bad rows.
- ST_Point(longitude, latitude) order; taxi_zones / gtp_tlc_data have no lat/lon columns.
- Spherical distance in meters: ST_Distance(to_spherical_geography(ST_Point(lon,lat)), ...).
- qualify duplicate column names across joins (geoid, year, month).
- census_tracts ↔ census_tract_demographics: ONLY ON TRIM(CAST(ct.geoid AS VARCHAR)) = TRIM(CAST(demo.geoid AS VARCHAR)); never join ACS on borough/ctlabel alone.
- census_tract_demographics counts/medians are STRING: VARCHAR for display; for math use TRY_CAST(TRIM(REGEXP_REPLACE(col, ',', '')) AS DOUBLE) (BIGINT cast often NULL). Avoid WHERE ... TRY_CAST(... AS BIGINT) IS NOT NULL — empties results when BIGINT fails.
- Map-capable results: include latitude+longitude (or lat+lon/lng) in NYC bounds, or geometry_wkt / tract polygons, when the user wants a map or spatial overview — UI renders Leaflet from those columns.
- Map / "show where" / crash-or-incident maps: SELECT raw coordinates — for nypd_collisions use latitude and longitude columns as latitude/longitude in output (they exist as VARCHAR). Do NOT return only COUNT(*) or borough aggregates unless the user explicitly asks for a summary table without a map. Neighborhood nicknames: filter via census_tracts joined on tract — never short ambiguous LOWER(ntaname) LIKE '%bedford%' (includes Bedford Park, Bronx). Prefer LOWER(ntaname) LIKE 'bedford-stuyvesant%' OR ntaname IN ('Bedford-Stuyvesant (West)', 'Bedford-Stuyvesant (East)') for Bed-Stuy; for other areas use a distinctive official-name prefix or explicit IN list / point-in-polygon, not a generic substring shared across boroughs.
- Web map UI: users can switch point layers to a heat map and polygon layers to a choropleth when numeric columns exist in the result; preview fetch is ~999 rows max per Athena page — include a numeric metric column on tract/polygon rows for choropleth.
- nyc_311 + nypd_collisions: STRING columns h3_r8, h3_r9, h3_r10 are precomputed H3 cell IDs (res 8/9/10). Hex aggregation or “partition into H3”: GROUP BY h3_r9 (or r8/r10 per question), COUNT/SUM metrics, filter nonempty TRIM(h3_rN) <> ''; prefer these over H3 UDFs.
- mta_turnstile: ridership is a pre-aggregated count — SUM(TRY_CAST(ridership AS DOUBLE)), never COUNT(*). transit_timestamp via TRY_CAST AS TIMESTAMP (not FROM_ISO8601_TIMESTAMP). borough is Title Case; payment_method lowercase omny/metrocard; native lat/lon + h3_r8/9/10.
`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_tables",
    description:
      "Return all logical table names available in this warehouse (gtp_tlc_data, nyc_311, etc.).",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_schema",
    description:
      "Return descriptions and column lists for named tables. Call before drafting SQL.",
    input_schema: {
      type: "object",
      properties: {
        tables: {
          type: "array",
          description: "Warehouse table names, e.g. nyc_311, census_tracts",
          items: { type: "string" },
        },
      },
      required: ["tables"],
    },
  },
];

function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1] : text;
}

/** Accept SQL when model wraps it in <sql> tags, ``` fences, or puts one sentence before the query. */
function extractSqlFromText(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;

  const tagged = raw.match(/<sql>\s*([\s\S]*?)\s*<\/sql>/i);
  if (tagged) {
    const inner = tagged[1].trim();
    if (/^\s*(WITH|SELECT)\b/i.test(inner)) return inner;
  }

  const unfenced = stripCodeFences(raw).trim();
  if (/^\s*(WITH|SELECT)\b/i.test(unfenced)) return unfenced;

  const fenceRe = /```(?:sql)?\s*([\s\S]*?)```/gi;
  let fm: RegExpExecArray | null;
  while ((fm = fenceRe.exec(raw)) !== null) {
    const inner = fm[1].trim();
    if (/^\s*(WITH|SELECT)\b/i.test(inner)) return inner;
  }

  const lineAnchored = raw.match(/(?:^|\n)(\s*(?:WITH|SELECT)\b[\s\S]*)/i);
  if (lineAnchored) {
    let sql = lineAnchored[1].trim().replace(/```[\s\S]*$/, "").trim();
    if (/^\s*(WITH|SELECT)\b/i.test(sql)) return sql;
  }

  const afterIntro = raw.match(/[.:]\s*(\s*(?:WITH|SELECT)\b[\s\S]*)/i);
  if (afterIntro) {
    let sql = afterIntro[1].trim().replace(/```[\s\S]*$/, "").trim();
    if (/^\s*(WITH|SELECT)\b/i.test(sql)) return sql;
  }

  return null;
}

function truncatePreview(raw: string, max = OBSERVE_PREVIEW_MAX): string {
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)}\n… (${raw.length} chars total)`;
}

/** Prose summary before the SQL block (for SSE "reason" on final turn). */
function extractLeadingProseBeforeSql(fullText: string, sql: string): string {
  const trimmed = fullText.trim();
  const at = trimmed.indexOf(sql);
  if (at >= 0) return trimmed.slice(0, at).trim();

  const lines = trimmed.split(/\r?\n/);
  const sqlLineIdx = lines.findIndex((l) => /^\s*(WITH|SELECT)\b/i.test(l));
  if (sqlLineIdx >= 0) return lines.slice(0, sqlLineIdx).join("\n").trim();

  return stripCodeFences(trimmed.replace(sql, "")).trim();
}

function runTool(name: string, input: unknown): string {
  if (name === "list_tables") {
    return JSON.stringify(listWarehouseTableNames(), null, 2);
  }
  if (name === "get_schema") {
    const obj = input as { tables?: unknown };
    const tables = Array.isArray(obj.tables) ? obj.tables.map(String) : [];
    if (tables.length === 0) return "Error: provide non-empty tables array.";
    return renderTablesForPrompt(tables);
  }
  return `Unknown tool: ${name}`;
}

export type RunSqlAgentOptions = {
  /** When set, tokens/cost are written to nl2sql.query_runs on successful SQL generation. */
  queryRunId?: string;
  /** Override the agent system prompt (prompt-version A/B testing). Defaults to AGENT_SYSTEM. */
  systemPrompt?: string;
};

export async function runSqlAgentWithEvents(
  question: string,
  onEvent: (e: AgentStreamPayload) => void | Promise<void>,
  options?: RunSqlAgentOptions
): Promise<SqlGenerationResult> {
  const model = process.env.CLAUDE_MODEL ?? DEFAULT_MODEL;
  // Explicit override (eval --prompt-version) wins; otherwise use the production
  // prompt from nl2sql.prompt_versions, falling back to the in-repo AGENT_SYSTEM.
  let systemPrompt = options?.systemPrompt;
  if (systemPrompt == null) {
    const prod = await getProductionPromptVersion();
    systemPrompt = prod?.systemPrompt ?? AGENT_SYSTEM;
  }
  const tokenAcc = createAccumulator();

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    await onEvent({ type: "turn", index: turn });

    const response = await getAnthropicClient().messages.create({
      model,
      max_tokens: 4096,
      ...CLAUDE_DETERMINISTIC_SAMPLING,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    addUsage(tokenAcc, response.usage);

    const reasoningText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join("\n");

    if (response.stop_reason === "end_turn") {
      const sql = extractSqlFromText(reasoningText);
      if (!sql) {
        throw new Error("Agent ended without a SELECT/WITH SQL statement");
      }

      const prose = extractLeadingProseBeforeSql(reasoningText, sql);
      let summary: string | undefined;
      if (prose.trim()) {
        summary = prose.trim().slice(0, 1200);
        await onEvent({
          type: "summary",
          text: summary,
        });
      }

      const tokensUsed = buildTokenSummary(tokenAcc);
      const costUsd = computeCostUsd(
        tokenAcc.input_tokens,
        tokenAcc.output_tokens,
        model
      );

      if (options?.queryRunId) {
        void writeTokensToQueryRun(options.queryRunId, tokensUsed, costUsd);
      }

      return {
        sql,
        model,
        inputTokens: tokenAcc.input_tokens,
        outputTokens: tokenAcc.output_tokens,
        tokensUsed,
        costUsd,
        summary,
      };
    }

    if (response.stop_reason !== "tool_use") {
      throw new Error(`Unexpected stop_reason: ${response.stop_reason}`);
    }

    if (reasoningText) {
      await onEvent({ type: "reason", text: reasoningText.slice(0, 1200) });
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      await onEvent({
        type: "tool_act",
        name: block.name,
        input: block.input,
      });

      const payload = runTool(block.name, block.input);

      await onEvent({
        type: "tool_observe",
        name: block.name,
        preview: truncatePreview(payload),
        bytes: new TextEncoder().encode(payload).length,
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: payload,
      });
    }

    if (toolResults.length === 0) {
      throw new Error("tool_use stop with no tool_use blocks");
    }

    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(`Agent exceeded ${MAX_AGENT_TURNS} turns without returning SQL`);
}

export async function generateSqlWithAgent(
  question: string,
  options?: { systemPrompt?: string }
): Promise<SqlGenerationResult> {
  return runSqlAgentWithEvents(question, () => undefined, options);
}
