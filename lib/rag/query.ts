import { getAnthropicClient } from "@/lib/anthropic-client";
import { getPgPool, isDatabaseConfigured } from "@/lib/db";

export const TOP_K = 5;
export const SIMILARITY_THRESHOLD = 0.4;

/** Must match the model used during ingestion (`scripts/chunk_and_embed.py`). */
export const EMBEDDING_MODEL = "text-embedding-3-small";

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

export type RagChunk = {
  id: number;
  content: string;
  source: string;
  source_type: string | null;
  section: string | null;
  page_num: number | null;
  date: string | null;
  similarity: number;
};

export type RagQueryResult = {
  answer: string;
  abstained: boolean;
  abstain_reason?: string;
  chunks: RagChunk[];
  usage?: { input_tokens: number; output_tokens: number };
};

export function ragConfigError(): string | null {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return "OPENAI_API_KEY is not configured (required for query embeddings)";
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return "ANTHROPIC_API_KEY is not configured";
  }
  if (!isDatabaseConfigured()) {
    return "NEON_DATABASE_URL is not configured";
  }
  return null;
}

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

async function retrieveChunks(
  embedding: number[],
  topK: number = TOP_K
): Promise<RagChunk[]> {
  const embeddingStr = `[${embedding.join(",")}]`;

  const pool = getPgPool();
  if (!pool) throw new Error("Database not configured");

  const client = await pool.connect();
  try {
    await client.query("SET search_path TO nl2sql");
    const result = await client.query<RagChunk>(
      `SELECT
          id,
          content,
          COALESCE(metadata->>'source', metadata->>'source_url', 'Unknown') AS source,
          source_type,
          metadata->>'section' AS section,
          (metadata->>'page')::integer AS page_num,
          NULLIF(metadata->>'doc_date', '') AS date,
          1 - (embedding <=> $1::nl2sql.vector) AS similarity
       FROM nl2sql.chunks
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::nl2sql.vector
       LIMIT $2`,
      [embeddingStr, topK]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

function buildContext(chunks: RagChunk[]): string {
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

async function logRagQuery(params: {
  question: string;
  chunks: RagChunk[];
  answer: string | null;
  abstained: boolean;
  abstainReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  topSimilarity?: number;
}): Promise<void> {
  const chunkIds = params.chunks.map((c) => c.id);
  const pool = getPgPool();
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO nl2sql.rag_queries
         (question, retrieved_chunk_ids, answer, abstained, abstain_reason,
          prompt_tokens, completion_tokens, top_similarity)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8)`,
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
  } catch (err) {
    console.error("[rag/query] failed to log query:", err);
  }
}

/**
 * Embed → retrieve → generate with faithfulness constraint.
 * Used by POST /api/rag/query and hybrid executeRAG.
 */
export async function ragQuery(question: string): Promise<RagQueryResult> {
  const configError = ragConfigError();
  if (configError) {
    throw new Error(configError);
  }

  const trimmed = question.trim();
  if (!trimmed) {
    throw new Error("question is required");
  }

  const queryEmbedding = await embedQuery(trimmed);
  const chunks = await retrieveChunks(queryEmbedding, TOP_K);
  const topSimilarity = Number(chunks[0]?.similarity ?? 0);

  if (chunks.length === 0 || topSimilarity < SIMILARITY_THRESHOLD) {
    const result: RagQueryResult = {
      answer:
        "I don't have information in my documents that's relevant to this question.",
      abstained: true,
      abstain_reason: "low_relevance",
      chunks: [],
    };

    await logRagQuery({
      question: trimmed,
      chunks: [],
      answer: result.answer,
      abstained: true,
      abstainReason: "low_relevance",
      topSimilarity,
    });

    return result;
  }

  const context = buildContext(chunks);
  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5";

  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens: 1024,
    system: RAG_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `<context>\n${context}\n</context>\n\nQuestion: ${trimmed}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const answer = textBlock?.type === "text" ? textBlock.text : "";

  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };

  await logRagQuery({
    question: trimmed,
    chunks,
    answer,
    abstained: false,
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    topSimilarity,
  });

  return {
    answer,
    abstained: false,
    chunks,
    usage,
  };
}
