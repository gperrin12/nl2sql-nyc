import Anthropic from "@anthropic-ai/sdk";
import type { SqlGenerationResult } from "@/lib/claude";
import { listWarehouseTableNames, renderTablesForPrompt } from "@/lib/schemas";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_MODEL = "claude-sonnet-4-5";

const MAX_TURNS = 14;

const AGENT_SYSTEM = `You translate natural-language questions into AWS Athena SQL (Trino dialect) for a NYC civic-data warehouse.

You work in steps using tools:
1. Call list_tables if you need to see what tables exist.
2. Call get_schema for EVERY table you will reference in SQL before writing the query (pull only what you need — reduces hallucinated columns).
3. When schema is sufficient, respond with ONE SQL query only: no prose, no markdown fences, single SELECT or WITH. Include LIMIT 1000 unless the user asks otherwise.

Dialect rules (must still obey):
- Partitioned tables: filter year/month as VARCHAR ('2024'), not bare integers.
- VARCHAR vs numeric comparisons need TRY_CAST; NYC lat/lon bounds use TRY_CAST(... AS DOUBLE).
- TLC zone joins: align INTEGER/VARCHAR for locationid vs pulocationid.
- ST_Point(longitude, latitude) order; taxi_zones / gtp_tlc_data have no lat/lon columns.
- Spherical distance in meters: ST_Distance(to_spherical_geography(ST_Point(lon,lat)), ...).
- qualify duplicate column names across joins (geoid, year, month).
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

function extractSqlFromText(text: string): string | null {
  const sql = stripCodeFences(text).trim();
  if (/^\s*(WITH|SELECT)\b/i.test(sql)) return sql;
  return null;
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

export async function generateSqlWithAgent(question: string): Promise<SqlGenerationResult> {
  const model = process.env.CLAUDE_MODEL ?? DEFAULT_MODEL;
  let inputTokens = 0;
  let outputTokens = 0;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: AGENT_SYSTEM,
      tools: TOOLS,
      messages,
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    if (response.stop_reason === "end_turn") {
      const textParts = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text);
      const combined = textParts.join("\n").trim();
      const sql = extractSqlFromText(combined);
      if (!sql) {
        throw new Error("Agent ended without a SELECT/WITH SQL statement");
      }
      return { sql, model, inputTokens, outputTokens };
    }

    if (response.stop_reason !== "tool_use") {
      throw new Error(`Unexpected stop_reason: ${response.stop_reason}`);
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const payload = runTool(block.name, block.input);
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

  throw new Error(`Agent exceeded ${MAX_TURNS} turns without returning SQL`);
}
