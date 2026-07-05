-- Bumps the default per-question countdown from 30s to 60s
-- (lib/trivia-room-constants.ts ROOM_QUESTION_DURATION_SECONDS). Room creation
-- always passes the duration explicitly, so this only matters for any insert
-- path that omits it. Safe to re-run.

ALTER TABLE trivia_rooms
  ALTER COLUMN question_duration_seconds SET DEFAULT 60;
