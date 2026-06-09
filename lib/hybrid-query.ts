/**
 * HYBRID Query Execution Path
 * POST /api/hybrid/query
 *
 * Runs SQL and RAG concurrently, then synthesizes a combined answer
 * with dual-source citations.
 *
 * Module 12 — AI Engineering Bootcamp
 */

import { getAnthropicClient } from "@/lib/anthropic-client";
import { waitForAthenaResults } from "@/lib/athena-wait";
import { ragQuery } from "@/lib/rag/query";
import { runQueryPipeline } from "@/lib/run-query-pipeline";
import { generateSqlWithAgent } from "@/lib/sql-agent/run";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SQLResult {
  sql: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  tableName: string;           // e.g. "nyc_311"
  timestamp: string;           // ISO 8601 — when the query ran
  runtimeMs: number;
}

export interface RAGChunk {
  content: string;
  source: string;              // e.g. "Community Board 4 Brooklyn Meeting Minutes"
  date: string;                // e.g. "March 2023"
  section: string;             // e.g. "New Business — Rezoning Impacts"
  page: number | null;
  similarity: number;          // cosine similarity score, 0–1
  chunkId: string;             // unique identifier in your chunks table
}

export interface RAGResult {
  answer: string;
  chunks: RAGChunk[];
}

export interface HybridResponse {
  answer: string;
  sqlResult: SQLResult | null;
  ragResult: RAGResult | null;
  partialFailure?: {
    side: "sql" | "rag";
    reason: string;
  };
}

// ---------------------------------------------------------------------------
// Step 1: executeSQL
//
// Agentic NL→SQL via runQueryPipeline (guardrails + Athena start), then block
// until rows are available — unlike /api/query/start, which returns executionId
// for client polling.
// ---------------------------------------------------------------------------

function inferPrimaryTable(sql: string): string {
  const match = sql.match(/\bFROM\s+([a-z_][\w]*)/i);
  return match?.[1] ?? "athena";
}

function settledReason(result: PromiseSettledResult<unknown>): string {
  if (result.status === "fulfilled") return "";
  const reason = result.reason;
  return reason instanceof Error ? reason.message : String(reason);
}

async function executeSQL(question: string): Promise<SQLResult> {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();

  const pipeline = await runQueryPipeline({
    question,
    backend: "agent",
    generate: () => generateSqlWithAgent(question),
  });

  if (!pipeline.ok) {
    const detail =
      typeof pipeline.body.detail === "string"
        ? pipeline.body.detail
        : typeof pipeline.body.error === "string"
          ? pipeline.body.error
          : "SQL pipeline failed";
    throw new Error(detail);
  }

  const athena = await waitForAthenaResults(pipeline.executionId);

  return {
    sql: pipeline.sql,
    rows: athena.rows.map((row) => ({ ...row })),
    rowCount: athena.rows.length,
    tableName: inferPrimaryTable(pipeline.sql),
    timestamp,
    runtimeMs: Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// Step 2: executeRAG
//
// Calls your RAG pipeline from Episode 10. Import the underlying function
// (not an HTTP call to the route) for lower latency and simpler error handling.
// ---------------------------------------------------------------------------

async function executeRAG(question: string): Promise<RAGResult> {
  const result = await ragQuery(question);

  return {
    answer: result.answer,
    chunks: result.chunks.map((chunk) => ({
      content: chunk.content,
      source: chunk.source,
      date: chunk.date ?? "unknown",
      section: chunk.section ?? "",
      page: chunk.page_num,
      similarity: chunk.similarity,
      chunkId: String(chunk.id),
    })),
  };
}

// ---------------------------------------------------------------------------
// Step 3: formatSQLForPrompt
//
// Serializes SQL results into the <quantitative_data> block that the
// synthesis prompt will receive. Keep it readable — the model needs to
// understand both the data and where it came from.
// ---------------------------------------------------------------------------

function formatSQLForPrompt(result: SQLResult): string {
  const rowsJson = JSON.stringify(result.rows, null, 2);
  return `<quantitative_data>
${rowsJson}
Source: ${result.tableName} via NYC Athena | ${result.rowCount} rows | Retrieved: ${result.timestamp}
</quantitative_data>`;
}

// ---------------------------------------------------------------------------
// Step 4: formatRAGForPrompt
//
// Serializes RAG chunks into the <document_context> block. Each chunk
// needs its metadata clearly labeled so the model can construct citations.
// ---------------------------------------------------------------------------

function formatRAGForPrompt(result: RAGResult): string {
  const blocks = result.chunks.map((chunk, i) => {
    const page = chunk.page != null ? String(chunk.page) : "N/A";
    return `[Document ${i + 1}]
Source: ${chunk.source}
Date: ${chunk.date}
Section: ${chunk.section || "N/A"}
Page: ${page}
ChunkID: ${chunk.chunkId}
---
${chunk.content}`;
  });

  const body =
    blocks.length > 0
      ? blocks.join("\n\n---\n\n")
      : result.answer;

  return `<document_context>
${body}
</document_context>`;
}

// ---------------------------------------------------------------------------
// Step 5: SYNTHESIS_INSTRUCTIONS
//
// This constant is the core of the module. It tells the model HOW to
// combine the two sources. Be explicit about:
//   - What [DATA: ...] citations must include
//   - What [DOC: ...] citations must include
//   - What to do if the sources conflict
//   - What to do if one source has no relevant information
// ---------------------------------------------------------------------------

const SYNTHESIS_INSTRUCTIONS = `
<synthesis_instructions>
Combine quantitative Athena results with government document context into one answer.

1. Use BOTH sources when available — do not ignore the structured data or the documents.
2. Quantitative claims must cite: [DATA: table, metric, date range, Source: NYC Athena]
3. Document claims must cite: [DOC: source name, date, section, page]
4. If sources conflict, state the discrepancy explicitly. Do not pick a side silently.
5. If one source is unavailable or has no relevant information, say so. Do not fabricate.
</synthesis_instructions>
`;

// ---------------------------------------------------------------------------
// Step 6: synthesize
//
// Makes the Claude synthesis call with both formatted sources and the
// synthesis instructions. Returns the answer text.
// ---------------------------------------------------------------------------

async function synthesize(
  question: string,
  sqlResult: SQLResult | null,
  ragResult: RAGResult | null
): Promise<string> {
  const dataPart = sqlResult
    ? formatSQLForPrompt(sqlResult)
    : "<quantitative_data>Unavailable — retrieval error.</quantitative_data>";

  const docPart = ragResult
    ? formatRAGForPrompt(ragResult)
    : "<document_context>Unavailable — retrieval error.</document_context>";

  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5";
  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens: 2048,
    system:
      "You are an NYC civic intelligence assistant combining structured data and government document context to answer questions about New York City. Your answers must be factual, well-cited, and acknowledge when sources conflict or when data is incomplete.",
    messages: [
      {
        role: "user",
        content: `${SYNTHESIS_INSTRUCTIONS}\n\n${dataPart}\n\n${docPart}\n\nQuestion: ${question}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Synthesis model returned no text content");
  }
  return textBlock.text.trim();
}

// ---------------------------------------------------------------------------
// executeHybrid: the main entry point
//
// Runs SQL and RAG concurrently with Promise.allSettled (not Promise.all —
// see lesson.md for why), then calls synthesize with whatever succeeded.
// ---------------------------------------------------------------------------

export async function executeHybrid(question: string): Promise<HybridResponse> {
  const [sqlSettled, ragSettled] = await Promise.allSettled([
    executeSQL(question),
    executeRAG(question),
  ]);

  const sqlResult = sqlSettled.status === "fulfilled" ? sqlSettled.value : null;
  const ragResult = ragSettled.status === "fulfilled" ? ragSettled.value : null;

  if (!sqlResult && !ragResult) {
    throw new Error(
      `Both SQL and RAG failed. SQL: ${settledReason(sqlSettled)}; RAG: ${settledReason(ragSettled)}`
    );
  }

  let partialFailure: HybridResponse["partialFailure"];
  if (!sqlResult && ragResult) {
    partialFailure = { side: "sql", reason: settledReason(sqlSettled) };
  } else if (sqlResult && !ragResult) {
    partialFailure = { side: "rag", reason: settledReason(ragSettled) };
  }

  const answer = await synthesize(question, sqlResult, ragResult);

  return {
    answer,
    sqlResult,
    ragResult,
    partialFailure,
  };
}

