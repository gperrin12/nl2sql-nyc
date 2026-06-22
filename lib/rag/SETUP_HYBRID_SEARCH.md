# Setting Up Hybrid Search + Reranking (Module 15)

## Prerequisites

- Your Neon Postgres instance with pgvector enabled
- `nl2sql.chunks` table with `embedding`, `content`, and `metadata` columns
- `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` set in `.env.local`

## Step 1: Enable pg_trgm and Create GIN Index

Run these SQL statements **once** in your Neon SQL Editor:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS chunks_content_trgm_idx ON nl2sql.chunks USING gin(content gin_trgm_ops);
```

Verify they exist:
```sql
SELECT * FROM pg_extension WHERE extname = 'pg_trgm';
SELECT indexname FROM pg_indexes WHERE tablename = 'chunks' AND indexname LIKE '%trgm%';
```

## Step 2: Test Hybrid Search Standalone

```bash
npx ts-node lib/rag/hybrid-search.ts
```

You should see chunks ranked by `hybrid_score` (blend of vector + keyword).

## Step 3: Test LLM Reranker

```bash
npx ts-node lib/rag/llm-reranker.ts
```

The reranker will take the mock chunks and reorder them by relevance.

## Step 4: Wire into Your RAG Endpoint

In your API route (e.g., `app/api/rag/query/route.ts`), replace the naive retrieval:

**Before (Module 10):**
```typescript
const chunks = await retrieveChunks(embedding, TOP_K);
```

**After (Module 15):**
```typescript
import { enhancedRetrieve } from "@/lib/rag/enhanced-retrieval";

const { chunks, metrics } = await enhancedRetrieve(question, {
  alpha: 0.5,           // 50% vector, 50% keyword (tune on your test set)
  hybrid_limit: 10,     // Retrieve 10 candidates
  top_k: 5,            // Return top-5 after reranking
  use_reranking: true, // Enable reranking
});

// Log metrics for observability
console.log(`Retrieval: ${metrics.total_ms}ms (hybrid: ${metrics.hybrid_search_ms}ms, rerank: ${metrics.reranking_ms}ms)`);
```

## Step 5: Benchmark Against Naive RAG

Create a test script to compare all three strategies:

```typescript
import { enhancedRetrieve } from "@/lib/rag/enhanced-retrieval";

const testQuestion = "How many 311 noise complaints were filed in Bushwick in August 2023?";

// Naive: vector only
const naive = await enhancedRetrieve(testQuestion, {
  alpha: 1.0,           // 100% vector
  use_reranking: false, // No reranking
});

// Hybrid: vector + keyword
const hybrid = await enhancedRetrieve(testQuestion, {
  alpha: 0.5,           // 50/50 blend
  use_reranking: false, // No reranking
});

// Hybrid + Reranking
const reranked = await enhancedRetrieve(testQuestion, {
  alpha: 0.5,
  use_reranking: true,
});

console.log(`Naive:             ${naive.metrics.total_ms}ms`);
console.log(`Hybrid:            ${hybrid.metrics.total_ms}ms`);
console.log(`Hybrid + Rerank:   ${reranked.metrics.total_ms}ms`);
```

## Tuning Alpha

The `alpha` parameter controls the blend of vector and keyword scores:

- `alpha = 1.0` — Pure vector search (Module 10 behavior)
- `alpha = 0.7` — 70% semantic, 30% keyword (good for conceptual questions)
- `alpha = 0.5` — Equal blend (good general-purpose setting)
- `alpha = 0.3` — 30% semantic, 70% keyword (good for entity/date questions)
- `alpha = 0.0` — Pure keyword search (baseline)

**Pro tip:** Run your 10 hardest questions at `alpha = 0.3, 0.5, 0.7` and measure which produces the best chunks via LLM judge. Document your finding.

## Expected Latency

Approximate breakdown on your system:

| Component | Time |
|-----------|------|
| Query embedding | ~50ms |
| Hybrid search (SQL + scoring) | ~30-60ms |
| Reranker LLM call (Haiku) | ~200-400ms |
| **Total without reranking** | ~100-150ms |
| **Total with reranking** | ~300-550ms |

Reranking adds 200-400ms. Decide based on whether the quality improvement justifies the latency cost.

## Files

- **`hybrid-search.ts`** — Hybrid retrieval combining vector + keyword
- **`llm-reranker.ts`** — Claude Haiku reranker for top-K ordering
- **`enhanced-retrieval.ts`** — Full pipeline with metrics and convenience functions

## Next Steps

- Run the benchmark script to measure quality improvement on your hardest questions
- Tune `alpha` on your eval set
- Measure p95 latency impact in production
- Document findings for Module 21 (portfolio writeup)
