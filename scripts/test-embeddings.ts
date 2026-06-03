/**
 * test-embeddings.ts — SOLUTION
 *
 * Complete implementation: embed 10 NYC civic sentences with text-embedding-3-small,
 * store in pgvector, and retrieve top-3 similar neighbors for each.
 *
 * Run:  npx tsx scripts/test-embeddings.ts
 */

import { loadEnvFile } from "../lib/load-env-file";
loadEnvFile();

import { Pool } from "pg";
import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const EMBEDDING_MODEL = "text-embedding-3-small";

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

const sentences: string[] = [
  "The community board voted against the rezoning proposal for the waterfront site.",
  "Subway delays on the A and C lines increased significantly during rush hour.",
  "The Department of Sanitation missed collection targets in three Brooklyn districts.",
  "Local residents expressed concerns about displacement and gentrification at the public hearing.",
  "311 noise complaints in Bushwick rose 34 percent in the second quarter.",
  "The mayor's management report shows improved response times for emergency services.",
  "Affordable housing units in the Bronx fell short of the annual construction target.",
  "Ferry service to Governors Island will be extended through November this year.",
  "Census data indicates the median household income in Queens increased by eight percent.",
  "The city council approved the rezoning with conditions related to community benefit agreements.",
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function toVectorString(embedding: number[]): string {
  // pgvector expects the format '[x,y,z,...]' when passed as a SQL parameter
  return `[${embedding.join(",")}]`;
}

// ---------------------------------------------------------------------------
// Phase 1: Embed
// ---------------------------------------------------------------------------

async function embedSentences(texts: string[]): Promise<number[][]> {
  console.log(`\nEmbedding ${texts.length} sentences with ${EMBEDDING_MODEL}...`);

  // Pass the entire array in one API call — more efficient than one call per sentence.
  // The API guarantees response.data is in the same order as the input array.
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });

  return response.data.map((item) => item.embedding);
}

// ---------------------------------------------------------------------------
// Phase 2: Store
// ---------------------------------------------------------------------------

async function storeEmbeddings(
  texts: string[],
  embeddings: number[][]
): Promise<void> {
  const client = await pool.connect();

  try {
    // Clear previous test run so similarity results don't include stale data
    console.log("\nClearing previous test data...");
    await client.query(`DELETE FROM documents WHERE source = 'exercise-test'`);

    console.log(`Inserting ${texts.length} rows...`);

    for (let i = 0; i < texts.length; i++) {
      await client.query(
        // The ::vector cast tells pgvector to parse the '[x,y,...]' string into a vector type.
        // Without the cast you'll get: "column 'embedding' is of type vector but expression is of type text"
        `INSERT INTO documents (content, embedding, source)
         VALUES ($1, $2::vector, $3)`,
        [texts[i], toVectorString(embeddings[i]), "exercise-test"]
      );
    }

    console.log(`Stored ${texts.length} embeddings.`);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Phase 3: Similarity search
// ---------------------------------------------------------------------------

async function findSimilar(
  queryText: string,
  queryEmbedding: number[],
  topK: number = 3
): Promise<Array<{ content: string; similarity: number }>> {
  const client = await pool.connect();

  try {
    // <=> returns cosine DISTANCE (0 = identical, 2 = maximally different).
    // 1 - distance = cosine SIMILARITY (1 = identical).
    // ORDER BY <=> ASC puts the closest vectors first.
    // WHERE content != $2 excludes the query sentence from its own results.
    const result = await client.query<{ content: string; similarity: number }>(
      `SELECT content,
              1 - (embedding <=> $1::vector) AS similarity
       FROM documents
       WHERE source = 'exercise-test'
         AND content != $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [toVectorString(queryEmbedding), queryText, topK]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(60));
  console.log("Module 06: Embeddings + Vector Search — Solution");
  console.log("=".repeat(60));

  try {
    // Phase 1
    const embeddings = await embedSentences(sentences);
    console.log(
      `Got ${embeddings.length} embeddings, each with ${embeddings[0].length} dimensions`
    );

    // Sanity check: embeddings should have 1536 dimensions for text-embedding-3-small
    if (embeddings[0].length !== 1536) {
      throw new Error(
        `Unexpected embedding dimensions: ${embeddings[0].length} (expected 1536)`
      );
    }

    // Phase 2
    await storeEmbeddings(sentences, embeddings);

    // Phase 3
    console.log("\n" + "=".repeat(60));
    console.log("Similarity Results");
    console.log("=".repeat(60));

    for (let i = 0; i < sentences.length; i++) {
      const query = sentences[i];
      const queryEmbedding = embeddings[i];

      console.log(`\nQuery: "${query}"`);
      console.log("Top 3 similar:");

      const results = await findSimilar(query, queryEmbedding, 3);

      if (results.length === 0) {
        console.log("  (no results — check that other rows exist in the table)");
        continue;
      }

      results.forEach((result, rank) => {
        const simStr = result.similarity.toFixed(4);
        // Flag high-confidence matches (> 0.85) to make the output scannable
        const marker = result.similarity > 0.85 ? " ***" : "";
        console.log(`  ${rank + 1}. [${simStr}] "${result.content}"${marker}`);
      });
    }

    console.log("\n" + "=".repeat(60));
    console.log("Done. *** = similarity > 0.85 (high confidence match)");
    console.log(
      "\nNote: with only 9 neighbors per query, similarity scores tend to cluster"
    );
    console.log(
      "in the 0.5–0.9 range. The high-dimensional curse of dimensionality is real."
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
