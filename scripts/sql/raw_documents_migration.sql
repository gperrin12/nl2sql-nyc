-- Migration: Create raw_documents table
-- Run this before scrape_mmr.py
-- Module 07: Document Scraping — Mayor's Management Report

-- This table stores one row per source document (not per chunk).
-- It's the upstream record for the chunking pipeline in Module 08.

CREATE TABLE IF NOT EXISTS nl2sql.raw_documents (
    id              BIGSERIAL PRIMARY KEY,
    url             TEXT NOT NULL UNIQUE,       -- canonical source URL (also the idempotency key)
    title           TEXT NOT NULL,              -- human-readable document name
    doc_type        TEXT NOT NULL,              -- 'mmr', 'cb_minutes', 'ulurp' — used for filtering
    doc_date        DATE,                       -- publication date (fiscal year close for MMR)
    file_path       TEXT NOT NULL,              -- absolute path to cached PDF on disk
    raw_text_path   TEXT,                       -- absolute path to extracted markdown file on disk
    page_count      INT,                        -- total pages extracted
    extracted_at    TIMESTAMPTZ DEFAULT NOW(),  -- when extraction ran
    metadata        JSONB DEFAULT '{}'::jsonb   -- doc-type-specific fields (fiscal_year, borough, etc.)
);

-- Index for filtering by document type (used heavily in chunking + retrieval)
CREATE INDEX IF NOT EXISTS idx_raw_documents_doc_type
    ON nl2sql.raw_documents (doc_type);

-- Index for date-range queries
CREATE INDEX IF NOT EXISTS idx_raw_documents_doc_date
    ON nl2sql.raw_documents (doc_date);

-- TODO: After creating this table, verify with:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'nl2sql.raw_documents' ORDER BY ordinal_position;
