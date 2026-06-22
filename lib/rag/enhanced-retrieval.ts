/**
 * enhanced-retrieval.ts
 *
 * Production-grade retrieval pipeline combining:
 *   - Hybrid search (vector + keyword, retrieve top-10)
 *   - LLM reranking (Haiku reorders candidates, return top-3)
 *
 * Drop-in replacement for the naive retrieveChunks() in query.ts.
 * Measures latency of each stage for observability.
 */

import { hybridSearch, DEFAULT_ALPHA } from "./hybrid-search";
import { rerank } from "./llm-reranker";
import type { HybridSearchResult } from "./hybrid-search";

export type RagChunk = {
  id: number;
  content: string;
  source: string;
  source_type: string | null;
  section: string | null;
  page_num: number | null;
  date: string | null;
  similarity: number;
  vector_score?: number;
  keyword_score?: number;
  hybrid_score?: number;
};

export interface EnhancedRetrievalMetrics {
  hybrid_search_ms: number;
  reranking_ms: number;
  total_ms: number;
  strategy: "naive" | "hybrid" | "hybrid_reranked";
  candidates_retrieved: number;
  candidates_returned: number;
}

/**
 * Enhanced retrieval: hybrid search → rerank → return top-K.
 *
 * @param question - User query text
 * @param options - { alpha, hybrid_limit, top_k, use_reranking }
 * @returns chunks in reranked order, plus latency metrics
 */
export async function enhancedRetrieve(
  question: string,
  options: {
    alpha?: number;
    hybrid_limit?: number; // Retrieve this many candidates (default: 10)
    top_k?: number; // Return top-K after reranking (default: 3)
    use_reranking?: boolean; // Enable reranking? (default: true)
  } = {}
): Promise<{ chunks: RagChunk[]; metrics: EnhancedRetrievalMetrics }> {
  const alpha = options.alpha ?? DEFAULT_ALPHA;
  const hybrid_limit = options.hybrid_limit ?? 10;
  const top_k = options.top_k ?? 3;
  const use_reranking = options.use_reranking !== false;

  const t0 = Date.now();

  // Step 1: Hybrid search (retrieve many candidates)
  const t_hybrid_start = Date.now();
  const hybridResults = await hybridSearch(question, { alpha, limit: hybrid_limit });
  const hybrid_search_ms = Date.now() - t_hybrid_start;

  let finalResults = hybridResults;
  let reranking_ms = 0;

  // Step 2: Rerank (optional; otherwise return top-K by hybrid score)
  if (use_reranking && hybridResults.length > top_k) {
    const t_rerank_start = Date.now();
    finalResults = await rerank(question, hybridResults, { topK: top_k });
    reranking_ms = Date.now() - t_rerank_start;
  } else {
    finalResults = hybridResults.slice(0, top_k);
  }

  const total_ms = Date.now() - t0;

  // Convert to RagChunk format (add similarity field for backward compatibility)
  const chunks: RagChunk[] = finalResults.map((r) => ({
    id: r.id,
    content: r.content,
    source: r.source,
    source_type: r.source_type,
    section: r.section,
    page_num: r.page_num,
    date: r.date,
    similarity: r.vector_score, // Use vector score as primary similarity metric
    vector_score: r.vector_score,
    keyword_score: r.keyword_score,
    hybrid_score: r.hybrid_score,
  }));

  const metrics: EnhancedRetrievalMetrics = {
    hybrid_search_ms,
    reranking_ms,
    total_ms,
    strategy: use_reranking ? "hybrid_reranked" : "hybrid",
    candidates_retrieved: hybridResults.length,
    candidates_returned: chunks.length,
  };

  return { chunks, metrics };
}

/**
 * Quick benchmark comparing retrieval strategies.
 * Run with: npx ts-node lib/rag/enhanced-retrieval.ts
 */
async function main() {
  const question = "How many 311 noise complaints were filed in Bushwick in August 2023?";

  console.log(`Testing: "${question}"\n`);

  // Test 1: Hybrid search only (no reranking)
  console.log("=== Hybrid Search (no reranking) ===");
  const t1 = Date.now();
  const hybrid = await enhancedRetrieve(question, { use_reranking: false, top_k: 5 });
  const hybrid_duration = Date.now() - t1;
  console.log(`Latency: ${hybrid_duration}ms (hybrid: ${hybrid.metrics.hybrid_search_ms}ms)`);
  console.log(`Retrieved: ${hybrid.chunks.length} chunks\n`);
  hybrid.chunks.forEach((c, i) => {
    console.log(`  [${i + 1}] ${c.content.slice(0, 80)}...`);
    console.log(`      hybrid=${c.hybrid_score?.toFixed(3)} | vec=${c.vector_score?.toFixed(3)} | kw=${c.keyword_score?.toFixed(3)}\n`);
  });

  // Test 2: Hybrid search + reranking
  console.log("\n=== Hybrid Search + Reranking ===");
  const t2 = Date.now();
  const reranked = await enhancedRetrieve(question, { use_reranking: true, top_k: 3, hybrid_limit: 10 });
  const reranked_duration = Date.now() - t2;
  console.log(
    `Latency: ${reranked_duration}ms (hybrid: ${reranked.metrics.hybrid_search_ms}ms, rerank: ${reranked.metrics.reranking_ms}ms)`
  );
  console.log(`Retrieved: ${reranked.chunks.length} chunks from ${reranked.metrics.candidates_retrieved} candidates\n`);
  reranked.chunks.forEach((c, i) => {
    console.log(`  [${i + 1}] ${c.content.slice(0, 80)}...`);
  });

  console.log(`\nReranking added ${reranked.metrics.reranking_ms}ms latency for top-3 ranking.`);
}

main().catch(console.error);
