"""
chunk_and_embed.py — Chunking + Embedding Pipeline for NYC Intelligence

Implements two chunking strategies for the Mayor's Management Report:
  - fixed:         512-token chunks with 50-token overlap
  - section_aware: chunks respect agency section boundaries from Module 07

Usage:
  python chunk_and_embed.py --strategy fixed
  python chunk_and_embed.py --strategy section_aware
  python chunk_and_embed.py --strategy section_aware --source mmr_2024
  python chunk_and_embed.py --mode gutcheck

Prerequisites:
  - chunks_migration.sql has been run against your Neon instance
  - raw_documents table has MMR content (from Episode 07)
  - OPENAI_API_KEY and DATABASE_URL set in .env
"""

import argparse
import hashlib
import json
import os
import re
import sys
from contextlib import contextmanager

import tiktoken
from dotenv import load_dotenv
from openai import OpenAI
import psycopg2
from psycopg2.extras import RealDictCursor

load_dotenv()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMS = 1536          # must match the VECTOR() dimension in the table
CHUNK_SIZE = 512               # tokens
CHUNK_OVERLAP = 50             # tokens (10% of 512 — a good default)
BATCH_SIZE = 100               # chunks per embedding API call

# ---------------------------------------------------------------------------
# Database connection
# ---------------------------------------------------------------------------

@contextmanager
def get_db_connection():
    """Context manager for a psycopg2 connection. Closes on exit."""
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Tokenizer
# ---------------------------------------------------------------------------

# cl100k_base is the encoding used by text-embedding-3-small and text-embedding-3-large.
# Using the right tokenizer ensures chunk_size token counts match what the API bills.
enc = tiktoken.get_encoding("cl100k_base")


# ---------------------------------------------------------------------------
# Chunking strategies
# ---------------------------------------------------------------------------

def fixed_chunk(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """
    Split text into fixed-size token chunks with overlap.

    Args:
        text:       Input text to chunk
        chunk_size: Maximum tokens per chunk
        overlap:    Tokens shared between adjacent chunks (prevents boundary loss)

    Returns:
        List of text strings, each at most chunk_size tokens long.

    TODO: Implement this function.
    Hint: Use enc.encode() to tokenize, slice into chunks with stride = chunk_size - overlap,
          then decode each chunk back to text with enc.decode().
    """
    # TODO: implement fixed chunking
    raise NotImplementedError("Implement fixed_chunk() — see lesson.md for the pattern")


def parse_sections_from_markdown(markdown_text: str) -> list[dict]:
    """
    Parse agency sections from MMR markdown output.

    The MMR uses consistent heading patterns for agency sections.
    This parser identifies section boundaries by looking for:
      - Lines starting with '# ' or '## ' followed by a department/agency name
      - Lines matching the MMR's known agency name patterns

    Returns:
        List of dicts: [{"section": "Department of Sanitation", "text": "...", "page": None}, ...]

    This helper is provided so you can test section_aware_chunk() even if your
    Module 07 parser output isn't available yet. If you have section data from
    Module 07, pass it directly to section_aware_chunk() instead.
    """
    sections = []
    # Pattern: markdown headings that look like NYC agency names
    # The MMR typically uses ## for agency-level headings
    heading_pattern = re.compile(r"^#{1,3}\s+(.+)$", re.MULTILINE)

    matches = list(heading_pattern.finditer(markdown_text))
    if not matches:
        # No headings found — treat the whole document as one section
        return [{"section": "full_document", "text": markdown_text, "page": None}]

    for i, match in enumerate(matches):
        section_name = match.group(1).strip()
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(markdown_text)
        section_text = markdown_text[start:end].strip()
        if section_text:
            sections.append({
                "section": section_name,
                "text": section_text,
                "page": None,  # page info comes from Module 07's parser if available
            })

    return sections


def section_aware_chunk(
    sections: list[dict],
    chunk_size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> list[dict]:
    """
    Chunk a list of sections, keeping each chunk within its section boundary.

    Args:
        sections:   List of dicts from Module 07's parser or parse_sections_from_markdown().
                    Each dict must have: {"section": str, "text": str, "page": optional int}
        chunk_size: Maximum tokens per chunk
        overlap:    Overlap tokens between adjacent chunks

    Returns:
        List of dicts: [{"content": str, "section": str, "chunk_index": int, "page": optional int}, ...]

    TODO: Implement this function.
    Hint: For each section, call fixed_chunk() on section["text"], then wrap each result
          in a dict that includes the section name and chunk index.
    """
    # TODO: implement section-aware chunking
    raise NotImplementedError("Implement section_aware_chunk() — see lesson.md for the pattern")


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

openai_client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))


def embed_batch(texts: list[str]) -> list[list[float]]:
    """
    Call the OpenAI embeddings API for a batch of texts.

    Args:
        texts: List of strings to embed (max 2048 per call, but keep to BATCH_SIZE)

    Returns:
        List of embedding vectors, same order as input texts.

    TODO: Implement this function.
    Hint: Use openai_client.embeddings.create(input=texts, model=EMBEDDING_MODEL)
          and extract .data[i].embedding from the response.
    """
    # TODO: implement embed_batch
    raise NotImplementedError("Implement embed_batch() — see lesson.md for the pattern")


def embed_chunks(texts: list[str]) -> list[list[float]]:
    """
    Embed a list of texts in batches, printing progress.

    Args:
        texts: All chunk texts to embed

    Returns:
        All embedding vectors, in the same order as input.
    """
    all_embeddings = []
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        batch_embeddings = embed_batch(batch)
        all_embeddings.extend(batch_embeddings)
        done = min(i + BATCH_SIZE, len(texts))
        print(f"  Embedded {done}/{len(texts)} chunks")
    return all_embeddings


# ---------------------------------------------------------------------------
# Idempotent ingestion
# ---------------------------------------------------------------------------

def compute_content_hash(text: str) -> str:
    """SHA-256 hash of text content. Used for idempotent inserts."""
    return hashlib.sha256(text.encode()).hexdigest()


def upsert_chunks(
    chunks: list[dict],
    embeddings: list[list[float]],
    document_id: int,
    doc_type: str,
    source: str,
    strategy: str,
) -> tuple[int, int]:
    """
    Insert chunks into the database, skipping any that already exist (by content_hash).

    Args:
        chunks:      List of chunk dicts (must have 'content', optionally 'section', 'page', 'chunk_index')
        embeddings:  Embedding vectors, same order as chunks
        document_id: FK to raw_documents.id
        doc_type:    e.g. "mmr"
        source:      e.g. "mmr_2024"
        strategy:    "fixed" or "section_aware" — stored in metadata for comparison queries

    Returns:
        (inserted_count, skipped_count)

    TODO: Implement this function.
    Hint: For each chunk+embedding pair, build a metadata dict with source/doc_type/section/page/strategy,
          compute the content hash, and run an INSERT ... ON CONFLICT (content_hash) DO NOTHING.
          Track cur.rowcount to count inserted vs. skipped rows.
    """
    # TODO: implement upsert_chunks
    raise NotImplementedError("Implement upsert_chunks() — see lesson.md for the idempotency pattern")


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_raw_documents(source: str | None = None) -> list[dict]:
    """
    Load raw MMR documents from Postgres.

    Args:
        source: Optional source filter (e.g. "mmr_2024"). If None, loads all.

    Returns:
        List of dicts with: id, source, doc_type, content, metadata
    """
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if source:
                cur.execute(
                    "SELECT id, source, doc_type, content, metadata FROM raw_documents WHERE source = %s",
                    (source,),
                )
            else:
                cur.execute("SELECT id, source, doc_type, content, metadata FROM raw_documents")
            return [dict(row) for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# Retrieval gut-check
# ---------------------------------------------------------------------------

# 10 test questions with expected answer keywords.
# These cover different MMR agencies and question types.
# Edit these to match the specific MMR year you ingested.
GUTCHECK_QUESTIONS = [
    {
        "question": "What was the Department of Sanitation's residential missed collection rate?",
        "expected_keywords": ["missed", "collection", "sanitation"],
    },
    {
        "question": "How many miles of streets did the Department of Sanitation clean?",
        "expected_keywords": ["miles", "streets", "sanitation"],
    },
    {
        "question": "What percentage of FDNY structural fires were responded to within 5 minutes?",
        "expected_keywords": ["FDNY", "structural", "fire", "minutes"],
    },
    {
        "question": "What was the citywide 311 call volume?",
        "expected_keywords": ["311", "calls", "complaints"],
    },
    {
        "question": "What was the average NYPD response time for critical incidents?",
        "expected_keywords": ["NYPD", "response", "critical"],
    },
    {
        "question": "How many housing units did HPD inspect?",
        "expected_keywords": ["HPD", "housing", "inspect"],
    },
    {
        "question": "What was the Department of Transportation's pothole repair completion rate?",
        "expected_keywords": ["pothole", "repair", "DOT", "transportation"],
    },
    {
        "question": "How many lane miles of road did DOT repave?",
        "expected_keywords": ["lane miles", "repave", "DOT"],
    },
    {
        "question": "What was the Department of Parks' tree pruning completion rate?",
        "expected_keywords": ["parks", "tree", "pruning"],
    },
    {
        "question": "What was the citywide recycling rate reported in the MMR?",
        "expected_keywords": ["recycling", "rate", "percent"],
    },
]


def embed_query(question: str) -> list[float]:
    """Embed a single query string. Same model as document embeddings."""
    response = openai_client.embeddings.create(input=[question], model=EMBEDDING_MODEL)
    return response.data[0].embedding


def retrieve_top_chunks(query_embedding: list[float], strategy: str, top_k: int = 3) -> list[dict]:
    """Retrieve top-k most similar chunks for a given strategy."""
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    content,
                    metadata,
                    1 - (embedding <=> %s::vector) AS similarity
                FROM chunks
                WHERE metadata->>'strategy' = %s
                ORDER BY embedding <=> %s::vector
                LIMIT %s
            """, (query_embedding, strategy, query_embedding, top_k))
            return [dict(row) for row in cur.fetchall()]


def run_gutcheck():
    """
    Run 10 retrieval questions against both strategies and print a comparison.
    """
    print("\n=== Retrieval Gut-Check: Fixed vs. Section-Aware ===\n")

    strategies = ["fixed", "section_aware"]
    results = {s: [] for s in strategies}

    for q in GUTCHECK_QUESTIONS:
        question = q["question"]
        keywords = q["expected_keywords"]
        query_emb = embed_query(question)

        print(f"Q: {question}")
        for strategy in strategies:
            chunks = retrieve_top_chunks(query_emb, strategy, top_k=3)
            if not chunks:
                print(f"  [{strategy:>14}] No chunks found — is the corpus loaded?")
                results[strategy].append({"hit_at_1": False, "hit_at_3": False, "top_sim": 0.0})
                continue

            top_content = chunks[0]["content"].lower()
            top_sim = chunks[0]["similarity"]
            all_content = " ".join(c["content"].lower() for c in chunks)

            hit_at_1 = any(kw.lower() in top_content for kw in keywords)
            hit_at_3 = any(kw.lower() in all_content for kw in keywords)

            hit_label_1 = "HIT " if hit_at_1 else "MISS"
            hit_label_3 = "HIT" if hit_at_3 else "MISS"
            section = chunks[0]["metadata"].get("section", "—")[:40]

            print(f"  [{strategy:>14}] top-1: {hit_label_1} ({top_sim:.3f}) | top-3: {hit_label_3} | section: {section}")
            results[strategy].append({"hit_at_1": hit_at_1, "hit_at_3": hit_at_3, "top_sim": top_sim})

        print()

    print("=== Summary ===")
    for strategy in strategies:
        r = results[strategy]
        if not r:
            continue
        h1 = sum(1 for x in r if x["hit_at_1"])
        h3 = sum(1 for x in r if x["hit_at_3"])
        avg_sim = sum(x["top_sim"] for x in r) / len(r)
        print(f"  {strategy:>14}: top-1 hits {h1}/{len(r)} | top-3 hits {h3}/{len(r)} | avg similarity {avg_sim:.3f}")

    print()


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def run_pipeline(strategy: str, source: str | None):
    """Load, chunk, embed, and upsert using the specified strategy."""
    print(f"\n=== Chunking Pipeline: strategy={strategy}, source={source or 'all'} ===\n")

    # Load raw documents
    docs = load_raw_documents(source)
    if not docs:
        print("No documents found. Did you run the Episode 07 ingestion?")
        sys.exit(1)
    print(f"Loaded {len(docs)} raw document(s) from Postgres")

    for doc in docs:
        print(f"\nProcessing: {doc['source']} (id={doc['id']})")
        text = doc["content"]

        # --- Chunk ---
        if strategy == "fixed":
            raw_chunks = fixed_chunk(text)
            chunks = [
                {"content": c, "section": None, "page": None, "chunk_index": i}
                for i, c in enumerate(raw_chunks)
            ]
        elif strategy == "section_aware":
            sections = parse_sections_from_markdown(text)
            print(f"  Found {len(sections)} sections")
            chunks = section_aware_chunk(sections)
        else:
            print(f"Unknown strategy: {strategy}")
            sys.exit(1)

        print(f"  Generated {len(chunks)} chunks via {strategy} strategy")

        if not chunks:
            print("  No chunks generated — skipping")
            continue

        # --- Embed ---
        print(f"  Embedding {len(chunks)} chunks in batches of {BATCH_SIZE}...")
        texts = [c["content"] for c in chunks]
        embeddings = embed_chunks(texts)

        # --- Upsert ---
        print("  Upserting to Postgres...")
        inserted, skipped = upsert_chunks(
            chunks=chunks,
            embeddings=embeddings,
            document_id=doc["id"],
            doc_type=doc.get("doc_type", "mmr"),
            source=doc["source"],
            strategy=strategy,
        )
        print(f"  Done: {inserted} inserted, {skipped} skipped (already existed)")

    print("\nPipeline complete.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MMR Chunking + Embedding Pipeline")
    parser.add_argument(
        "--strategy",
        choices=["fixed", "section_aware"],
        default=os.environ.get("CHUNKING_STRATEGY", "section_aware"),
        help="Chunking strategy to use (default: CHUNKING_STRATEGY env var, or section_aware)",
    )
    parser.add_argument(
        "--source",
        default=None,
        help="Filter to a specific source in raw_documents (e.g. 'mmr_2024')",
    )
    parser.add_argument(
        "--mode",
        choices=["pipeline", "gutcheck"],
        default="pipeline",
        help="'pipeline' runs ingestion; 'gutcheck' runs retrieval quality check",
    )
    args = parser.parse_args()

    if args.mode == "gutcheck":
        run_gutcheck()
    else:
        run_pipeline(args.strategy, args.source)
