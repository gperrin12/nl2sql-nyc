/**
 * hybrid-search.ts
 *
 * Hybrid retrieval combining vector (cosine) similarity with trigram keyword matching.
 * Extends the naive RAG retriever from Module 10 with semantic + keyword scoring.
 *
 * Prerequisites:
 *   Run in Neon SQL editor (once):
 *     CREATE EXTENSION IF NOT EXISTS pg_trgm;
 *     CREATE INDEX IF NOT EXISTS chunks_content_trgm_idx ON nl2sql.chunks USING gin(content gin_trgm_ops);
 */

import { getPgPool } from "@/lib/db";
import { EMBEDDING_MODEL } from "./query";

// Blend vector and keyword scoring. Tunable; start at 0.5 (50/50).
// Increase toward 1.0 for more semantic weight.
// Decrease toward 0.0 for more keyword weight.
export const DEFAULT_ALPHA = 0.5;

export interface HybridSearchResult {
  id: number;
  content: string;
  metadata: Record<string, unknown>;
  source: string;
  source_type: string | null;
  section: string | null;
  page_num: number | null;
  date: string | null;
  vector_score: number;
  keyword_score: number;
  hybrid_score: number;
}

export interface HybridSearchOptions {
  alpha?: number;
  limit?: number;
}

/**
 * Embed a query using OpenAI (matches ingestion embedding model).
 * Reuses the same pattern as the existing embedQuery in query.ts.
 */
async function embedQuery(question: string): Promise<number[]> {
  const { default: OpenAI } = await import("openai");
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const openai = new OpenAI({ apiKey });
  const result = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: question,
  });
  return result.data[0].embedding;
}

/**
 * Run hybrid search: vector + keyword scoring in a single SQL query.
 *
 * The hybrid score formula:
 *   hybrid_score = alpha * vector_score + (1 - alpha) * keyword_score
 *
 * where:
 *   vector_score = 1 - (embedding <=> query_embedding)  [cosine distance inverted to similarity]
 *   keyword_score = similarity(content, query_text)       [pg_trgm trigram matching]
 */
export async function hybridSearch(
  query: string,
  options: HybridSearchOptions = {}
): Promise<HybridSearchResult[]> {
  const alpha = options.alpha ?? DEFAULT_ALPHA;
  const limit = options.limit ?? 10;

  const queryEmbedding = await embedQuery(query);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const pool = getPgPool();
  if (!pool) throw new Error("Database not configured");

  const client = await pool.connect();
  try {
    await client.query("SET search_path TO nl2sql");

    const sql = `
      SELECT
        id,
        content,
        metadata,
        COALESCE(metadata->>'source', metadata->>'source_url', 'Unknown') AS source,
        source_type,
        metadata->>'section' AS section,
        (metadata->>'page')::integer AS page_num,
        NULLIF(metadata->>'doc_date', '') AS date,
        (1 - (embedding <=> $1::nl2sql.vector)) AS vector_score,
        similarity(content, $2) AS keyword_score,
        ($3 * (1 - (embedding <=> $1::nl2sql.vector)) + (1 - $3) * similarity(content, $2)) AS hybrid_score
      FROM nl2sql.chunks
      WHERE embedding IS NOT NULL
      ORDER BY hybrid_score DESC
      LIMIT $4
    `;

    const result = await client.query<HybridSearchResult>(sql, [
      embeddingStr,
      query,
      alpha,
      limit,
    ]);

    return result.rows;
  } finally {
    client.release();
  }
}

// Quick test: run with `npx ts-node lib/rag/hybrid-search.ts`
async function main() {
  const question = "How many 311 noise complaints were filed in Bushwick in August 2023?";
  console.log(`Query: "${question}"\n`);
  console.log(`Alpha: ${DEFAULT_ALPHA * 100}% vector, ${(1 - DEFAULT_ALPHA) * 100}% keyword\n`);

  const results = await hybridSearch(question, { alpha: DEFAULT_ALPHA, limit: 10 });

  console.log(`Retrieved ${results.length} chunks:\n`);
  results.forEach((r, i) => {
    console.log(
      `[${i + 1}] hybrid=${r.hybrid_score.toFixed(3)} | vec=${r.vector_score.toFixed(3)} | kw=${r.keyword_score.toFixed(3)}`
    );
    console.log(`    ${r.content.slice(0, 100)}...\n`);
  });
}

main().catch(console.error);
