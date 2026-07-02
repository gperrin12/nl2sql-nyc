-- Adds host-controlled answer reveal to trivia rooms.
-- The host clicks "Reveal answer" to lock in all answers and show the correct
-- one to everyone at once; advancing to the next question resets it to false.
-- Run this against any DB that already applied 002 (safe to re-run).

ALTER TABLE trivia_rooms
  ADD COLUMN IF NOT EXISTS answer_revealed BOOLEAN NOT NULL DEFAULT false;
