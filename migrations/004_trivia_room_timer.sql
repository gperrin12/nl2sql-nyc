-- Adds a per-question countdown to trivia rooms.
-- Answers auto-lock when the timer runs out; the state endpoint auto-reveals
-- the answer once the window expires OR every non-host player has answered.
-- Bumps the default window from the original 20s to 30s. New rooms set the
-- duration explicitly, but the default keeps any older insert paths consistent.
-- Run this against any DB that already applied 002/003 (safe to re-run).

ALTER TABLE trivia_rooms
  ALTER COLUMN question_duration_seconds SET DEFAULT 30;
