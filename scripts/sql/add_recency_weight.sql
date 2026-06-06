-- add_recency_weight.sql — Episode 9: Schema Extension
--
-- Adds source_type and recency_weight columns to the chunks table.
-- Safe to run multiple times (uses IF NOT EXISTS and DO NOTHING patterns).
--
-- Run with:
--   psql $DATABASE_URL -f starter/add_recency_weight.sql

-- ---------------------------------------------------------------------------
-- Step 1: Add source_type column with a CHECK constraint
-- ---------------------------------------------------------------------------
-- source_type identifies which document collection a chunk came from.
-- The CHECK constraint enforces only known values — update it when you add
-- new source types (e.g., 'ulurp' in Module 18).
--
-- TODO: Run this and verify it succeeds.
-- If you get a constraint violation, existing rows have unexpected values in
-- source_type — check the current data before re-running.

ALTER TABLE chunks
    ADD COLUMN IF NOT EXISTS source_type TEXT
        CHECK (source_type IN ('mmr', 'community_board', 'ulurp'));

-- ---------------------------------------------------------------------------
-- Step 2: Add recency_weight column
-- ---------------------------------------------------------------------------
-- Stores the precomputed decay factor for each chunk.
-- Default 1.0 means existing rows (MMR chunks) are treated as maximally
-- recent until you explicitly compute and store their actual recency weight.
--
-- TODO: After running this migration, backfill MMR chunks if you want accurate
-- recency weights for them. For now, DEFAULT 1.0 is a reasonable placeholder.

ALTER TABLE chunks
    ADD COLUMN IF NOT EXISTS recency_weight FLOAT DEFAULT 1.0;

-- ---------------------------------------------------------------------------
-- Step 3: Add board_name column for community board attribution
-- ---------------------------------------------------------------------------
-- Stores the human-readable community board name (e.g., "CB4 Brooklyn").
-- NULL for non-community-board source types.

ALTER TABLE chunks
    ADD COLUMN IF NOT EXISTS board_name TEXT;

-- ---------------------------------------------------------------------------
-- Step 4: Backfill source_type for existing MMR chunks
-- ---------------------------------------------------------------------------
-- TODO: Uncomment and run this after Step 1 if you have existing MMR chunks
-- with NULL source_type. Replace the condition with whatever identifies your
-- MMR chunks (e.g., based on source_url pattern).

-- UPDATE chunks
--     SET source_type = 'mmr'
-- WHERE source_type IS NULL
--   AND source_url LIKE '%nyc.gov%mmr%';  -- adjust pattern to match your MMR URLs

-- ---------------------------------------------------------------------------
-- Verification queries — run these to confirm the migration succeeded
-- ---------------------------------------------------------------------------

-- Should show source_type, recency_weight, and board_name columns:
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'chunks'
--   AND column_name IN ('source_type', 'recency_weight', 'board_name')
-- ORDER BY column_name;

-- Should show CHECK constraint on source_type:
-- SELECT constraint_name, check_clause
-- FROM information_schema.check_constraints
-- WHERE constraint_name LIKE '%chunks%source_type%';

-- Distribution of source_type values after ingestion:
-- SELECT source_type, COUNT(*) FROM chunks GROUP BY source_type;
