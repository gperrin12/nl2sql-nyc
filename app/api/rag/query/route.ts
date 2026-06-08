/**
 * POST /api/rag/query
 *
 * Naive RAG endpoint for nl2sql-nyc.
 * Pipeline: embed query → similarity search → stuff context → generate with faithfulness constraint
 *
 * Place this file at: app/api/rag/query/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getPgPool } from "@/lib/db"; // existing Postgres pool from nl2sql-nyc

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";
const TOP_K = 5;
const SIMILARITY_THRESHOLD = 0.4; // Chunks below this score → abstain before generation

// Embedding model must match what was used during ingestion — mixing models breaks retrieval.
const EMBEDDING_MODEL = "text-embedding-3-small";

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ---------------------------------------------------------------------------
// RAG System Prompt
// ---------------------------------------------------------------------------

// TODO: Fill in the three TODOs below.
// These three constraints are the difference between a RAG system and a
// general-purpose assistant. Get the phrasing right — "use the context" and
// "use ONLY the context" produce measurably different model behavior.

const RAG_SYSTEM_PROMPT = `You are an NYC civic intelligence assistant. You help users understand
NYC government policies, agency performance data, and community decisions based on official documents.

<answer_guidelines>
- Answer using ONLY the provided context. Do not use your general knowledge, training data, or anything not explicitly stated in the documents. If you don't know something, say so rather than guessing.

- If the context does not contain enough information to answer the question, respond with: "I don't have this information in my documents."

- When stating facts, cite your sources in this format: [Source: document name, section, page N]
  Example: "The Department of Sanitation missed collection rate was 2.1% [Source: Mayor's Management Report 2026, DSNY, p.45]"

- Keep answers concise and factual. Prefer specific numbers and dates over vague summaries.
- If the context contains conflicting information from different sources, acknowledge both perspectives.
</answer_guidelines>`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Chunk {
  id: number;
  content: string;
  source: string;
  source_type: string | null;
  section: string | null;
  page_num: number | null;
  similarity: number;
}

interface RagQueryResult {
  answer: string;
  abstained: boolean;
  abstain_reason?: string;
  chunks: Chunk[];
  usage?: { input_tokens: number; output_tokens: number };
}

// ---------------------------------------------------------------------------
// Step 1: Embed the query
// ---------------------------------------------------------------------------

async function embedQuery(question: string): Promise<number[]> {
  // TODO: Embed the query using the same model used during ingestion (module 06).
  //
  // CRITICAL: Use input_type="query" (not "document") for Voyage AI.
  // The model uses different encodings for queries vs. documents — using "document"
  // for a query is a silent quality degradation that's easy to miss.
  //
  // Voyage AI example:
  //   const vo = new VoyageAI({ apiKey: process.env.VOYAGE_API_KEY });
  //   const result = await vo.embed({ input: [question], model: "voyage-3", inputType: "query" });
  //   return result.embeddings[0];
  //
  // OpenAI example:
  //   const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  //   const result = await openai.embeddings.create({ model: "text-embedding-3-small", input: question });
  //   return result.data[0].embedding;

  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const result = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: question,
  });
  return result.data[0].embedding;
}

// ---------------------------------------------------------------------------
// Step 2: Retrieve top-k chunks via pgvector cosine similarity
// ---------------------------------------------------------------------------

async function retrieveChunks(embedding: number[], topK: number = TOP_K): Promise<Chunk[]> {
  // TODO: Run a cosine similarity search against chunks.
  //
  // The embedding needs to be formatted as a pgvector string: '[0.1, -0.2, ...]'
  // Use the <=> operator for cosine distance; lower is more similar.
  // 1 - (embedding <=> $1::vector) gives you cosine similarity (higher = more similar).
  //
  // Query shape:
  //   SELECT id, content, source, source_type, section, page_num,
  //          1 - (embedding <=> $1::vector) AS similarity
  //   FROM chunks
  //   ORDER BY embedding <=> $1::vector
  //   LIMIT $2
  //
  // Then map results to Chunk objects.

  const embeddingStr = `[${embedding.join(",")}]`;

  const pool = getPgPool();
  if (!pool) throw new Error("Database not configured");

  // Set search_path and run query
  const client = await pool.connect();
  try {
    await client.query("SET search_path TO nl2sql");
    const result = await client.query<Chunk>(
      `SELECT
          id,
          content,
          COALESCE(metadata->>'source', metadata->>'source_url', 'Unknown') as source,
          source_type,
          metadata->>'section' as section,
          (metadata->>'page')::integer as page_num,
          1 - (embedding <=> $1::vector) AS similarity
       FROM chunks
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [embeddingStr, topK]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Step 3: Build context string with source metadata
// ---------------------------------------------------------------------------

function buildContext(chunks: Chunk[]): string {
  // TODO: Format chunks into a context block for the prompt.
  //
  // Each chunk should include its source metadata so the model can cite it.
  // Structure:
  //   [Document N]
  //   Source: <source name>
  //   Section: <section or "N/A">
  //   Page: <page_num or "N/A">
  //   ---
  //   <content>
  //
  // Join chunks with double newlines.

  return chunks
    .map(
      (chunk, i) => `[Document ${i + 1}]
Source: ${chunk.source}
Section: ${chunk.section ?? "N/A"}
Page: ${chunk.page_num ?? "N/A"}
---
${chunk.content}`
    )
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Step 4: Log the RAG query to rag_queries table
// ---------------------------------------------------------------------------

async function logRagQuery(params: {
  question: string;
  chunks: Chunk[];
  answer: string | null;
  abstained: boolean;
  abstainReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  topSimilarity?: number;
}): Promise<void> {
  // TODO: Insert a row into rag_queries.
  //
  // retrieved_chunk_ids should be a JSONB array of chunk IDs (numbers).
  // Use JSON.stringify(params.chunks.map(c => c.id)) for the JSONB value.
  //
  // Column reference (from rag_queries_migration.sql):
  //   question, retrieved_chunk_ids, answer, abstained, abstain_reason,
  //   prompt_tokens, completion_tokens, top_similarity, created_at

  const chunkIds = params.chunks.map((c) => c.id);
  const pool = getPgPool();
  if (!pool) throw new Error("Database not configured");

  await pool.query(
    `INSERT INTO nl2sql.rag_queries
       (question, retrieved_chunk_ids, answer, abstained, abstain_reason,
        prompt_tokens, completion_tokens, top_similarity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.question,
      JSON.stringify(chunkIds),
      params.answer,
      params.abstained,
      params.abstainReason ?? null,
      params.promptTokens ?? null,
      params.completionTokens ?? null,
      params.topSimilarity ?? null,
    ]
  );
}

// ---------------------------------------------------------------------------
// Main route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  let question: string;

  try {
    const body = await req.json();
    question = body.question?.trim();
    if (!question) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    // 1. Embed the query
    const queryEmbedding = await embedQuery(question);

    // 2. Retrieve top-k chunks
    const chunks = await retrieveChunks(queryEmbedding, TOP_K);

    // 3. Similarity threshold check — abstain before generation if retrieval failed
    const topSimilarity = chunks[0]?.similarity ?? 0;

    if (chunks.length === 0 || topSimilarity < SIMILARITY_THRESHOLD) {
      const result: RagQueryResult = {
        answer:
          "I don't have information in my documents that's relevant to this question.",
        abstained: true,
        abstain_reason: "low_relevance",
        chunks: [],
      };

      await logRagQuery({
        question,
        chunks: [],
        answer: result.answer,
        abstained: true,
        abstainReason: "low_relevance",
        topSimilarity,
      });

      return NextResponse.json(result);
    }

    // 4. Build context
    const context = buildContext(chunks);

    // 5. Generate answer with faithfulness constraint
    // TODO: Call anthropic.messages.create with:
    //   - system: RAG_SYSTEM_PROMPT
    //   - user message: context block + question
    //   - Place context BEFORE the question (improves recall in long-context settings)
    //   - Use XML tags to clearly separate context from the question
    //
    // Format:
    //   <context>
    //   {context}
    //   </context>
    //
    //   Question: {question}

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: RAG_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `<context>\n${context}\n</context>\n\nQuestion: ${question}`,
        },
      ],
    });

    const answer =
      response.content[0].type === "text" ? response.content[0].text : "";

    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };

    // 6. Log the query
    await logRagQuery({
      question,
      chunks,
      answer,
      abstained: false,
      promptTokens: usage.input_tokens,
      completionTokens: usage.output_tokens,
      topSimilarity,
    });

    const result: RagQueryResult = {
      answer,
      abstained: false,
      chunks,
      usage,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[rag/query] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
