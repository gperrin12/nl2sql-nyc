-- Migration: Create chunks table for MMR embedding pipeline
-- Run this against your Neon Postgres instance before running chunk_and_embed.py
--
-- Prerequisites:
--   - pgvector extension enabled (from Episode 6)
--   - raw_documents table exists (from Episode 7)
--
-- Run with:
--   psql $DATABASE_URL -f chunks_migration.sql

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS nl2sql.chunks (
    id           BIGSERIAL PRIMARY KEY,
    document_id  BIGINT REFERENCES nl2sql.raw_documents(id) ON DELETE CASCADE,
    content      TEXT NOT NULL,
    embedding    nl2sql.VECTOR(1536),                  -- dimensions for text-embedding-3-small
                                                -- change to 3072 for text-embedding-3-large
                                                -- change to 1024 for voyage-3
    chunk_index  INT NOT NULL,                  -- position of this chunk within the parent document
    metadata     JSONB,                         -- source, doc_type, section, page, strategy, etc.
    content_hash TEXT UNIQUE NOT NULL,          -- SHA-256 of content for idempotent ingestion
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast similarity search (create after loading initial data for speed)
-- We'll create this after the first ingestion run.
-- Uncomment and run separately once you have data loaded:
--
-- CREATE INDEX IF NOT EXISTS chunks_embedding_idx
--     ON chunks USING hnsw (embedding vector_cosine_ops)
--     WITH (m = 16, ef_construction = 64);

-- Index for metadata filtering (strategy, section, doc_type queries)
CREATE INDEX IF NOT EXISTS chunks_metadata_idx ON nl2sql.chunks USING gin (metadata);

-- Index for document_id lookups (delete-by-document operations)
CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON nl2sql.chunks (document_id);

-- Verify the table was created correctly
-- Run this separately after migration:
-- \d chunks
