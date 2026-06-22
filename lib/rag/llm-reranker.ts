/**
 * llm-reranker.ts
 *
 * Reranks top-N candidates (e.g., from hybrid search) using Claude Haiku.
 * The pattern: retrieve-many (top-10), rerank-few (top-3).
 *
 * Design: use Haiku for this classification task (not Sonnet).
 * Reranking is about sorting, not generating — Haiku is fast and cheap enough.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { HybridSearchResult } from "./hybrid-search";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Haiku is appropriate for reranking (classification/sorting, not generation)
const RERANKER_MODEL = "claude-haiku-4-5";

// Chunk preview length in the reranker prompt. 200 chars is enough to judge relevance.
const CHUNK_PREVIEW_LENGTH = 200;

export interface RerankOptions {
  topK?: number;
}

/**
 * Build the reranker prompt. Asks Claude to return ranked 1-based indices.
 */
function buildRerankPrompt(question: string, chunks: HybridSearchResult[]): string {
  const passages = chunks
    .map((c, i) => `[${i + 1}] ${c.content.slice(0, CHUNK_PREVIEW_LENGTH)}`)
    .join("\n\n");

  return `Question: ${question}

Rank these ${chunks.length} passages from most to least relevant to answering the question above.
Return ONLY a JSON array of 1-based indices in ranked order, most relevant first.
Example format: [3, 1, 5, 2, 4]
Do not include any explanation or prose — only the JSON array.

Passages:
${passages}`;
}

/**
 * Rerank a list of chunks using Claude Haiku.
 *
 * Falls back to original order if reranking fails, so a reranker bug
 * doesn't break the entire retrieval path.
 */
export async function rerank(
  question: string,
  chunks: HybridSearchResult[],
  options: RerankOptions = {}
): Promise<HybridSearchResult[]> {
  const topK = options.topK ?? 3;

  if (chunks.length === 0) return [];
  if (chunks.length <= topK) return chunks; // Nothing to rerank.

  const prompt = buildRerankPrompt(question, chunks);

  try {
    const response = await anthropic.messages.create({
      model: RERANKER_MODEL,
      max_tokens: 128,
      messages: [{ role: "user", content: prompt }],
    });

    // Extract text response
    const textContent = response.content.find((block) => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text in reranker response");
    }

    // Parse JSON array of indices
    let indices: number[];
    try {
      indices = JSON.parse(textContent.text);
    } catch {
      throw new Error(`Failed to parse reranker JSON: ${textContent.text}`);
    }

    if (!Array.isArray(indices)) {
      throw new Error("Reranker response is not an array");
    }

    // Validate indices are in range
    const validIndices = indices.filter((idx) => typeof idx === "number" && idx >= 1 && idx <= chunks.length);
    if (validIndices.length !== indices.length) {
      throw new Error(`Some indices out of range. Got: ${indices.join(", ")}, valid: 1-${chunks.length}`);
    }

    // Map indices back to chunks (1-based to 0-based) and slice to topK
    const reranked = indices.map((idx) => chunks[idx - 1]).slice(0, topK);

    return reranked;
  } catch (err) {
    console.warn(`Reranking failed, falling back to hybrid order: ${err}`);
    // Fallback: return top-K in original hybrid order
    return chunks.slice(0, topK);
  }
}

// Quick test: run with `npx ts-node lib/rag/llm-reranker.ts`
async function main() {
  const question = "What was the 311 noise complaint count in Bushwick in 2023?";

  // Mock chunks simulating hybrid search output
  const mockChunks: HybridSearchResult[] = [
    {
      id: 1,
      content:
        "Urban acoustic environments increasingly affect community wellbeing in northeastern Brooklyn neighborhoods, where population density and nightlife activity create complex soundscape dynamics.",
      metadata: { source: "mmr_2023", section: "Quality of Life" },
      source: "mmr_2023",
      source_type: "policy",
      section: "Quality of Life",
      page_num: 45,
      date: "2023-01-01",
      vector_score: 0.82,
      keyword_score: 0.05,
      hybrid_score: 0.435,
    },
    {
      id: 2,
      content:
        "Bushwick Community Board 4 — August 2023. Noise Complaints (311): 847 total. Top complaint types: Loud Music (312), Construction Noise (189), Ice Cream Truck (67).",
      metadata: { source: "cb4_minutes_aug2023", section: "311 Data Summary" },
      source: "cb4_minutes_aug2023",
      source_type: "board_minutes",
      section: "311 Data Summary",
      page_num: 12,
      date: "2023-08-01",
      vector_score: 0.61,
      keyword_score: 0.74,
      hybrid_score: 0.675,
    },
    {
      id: 3,
      content:
        "The Department of Environmental Protection noise code violations in Brooklyn increased 14% year-over-year in fiscal year 2023, driven primarily by construction activity near transit corridors.",
      metadata: { source: "mmr_2023", section: "Environmental Protection" },
      source: "mmr_2023",
      source_type: "policy",
      section: "Environmental Protection",
      page_num: 67,
      date: "2023-01-01",
      vector_score: 0.71,
      keyword_score: 0.18,
      hybrid_score: 0.445,
    },
  ];

  console.log("Input chunks (in hybrid search order):");
  mockChunks.forEach((c, i) =>
    console.log(`  [${i + 1}] hybrid=${c.hybrid_score.toFixed(3)} | ${c.content.slice(0, 60)}...`)
  );

  console.log("\nReranking with Claude...\n");

  const reranked = await rerank(question, mockChunks, { topK: 2 });

  console.log("Reranked top-2:");
  reranked.forEach((c, i) => console.log(`  [${i + 1}] ${c.content.slice(0, 80)}...`));
}

main().catch(console.error);
