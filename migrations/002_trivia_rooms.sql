-- Room-code multiplayer trivia (/trivia/live).
-- Separate tables from the solo hi-score board — no cross-writes in either direction.
-- Safe to re-run (IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS trivia_rooms (
  code TEXT PRIMARY KEY,
  host_player_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby','playing','finished')),
  questions JSONB NOT NULL,              -- locked array of {question, choices, correctIndex, categoryLabel}, length 10-20
  current_index INT NOT NULL DEFAULT 0,
  question_started_at TIMESTAMPTZ,
  question_duration_seconds INT NOT NULL DEFAULT 20,
  answer_revealed BOOLEAN NOT NULL DEFAULT false,  -- host reveals the answer for the current question; locks further answers
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trivia_room_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL REFERENCES trivia_rooms(code) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  score INT NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trivia_room_answers (
  room_code TEXT NOT NULL REFERENCES trivia_rooms(code) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES trivia_room_players(id) ON DELETE CASCADE,
  question_index INT NOT NULL,
  choice_index INT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_code, player_id, question_index)
);

CREATE INDEX IF NOT EXISTS trivia_room_players_room_idx ON trivia_room_players(room_code);
CREATE INDEX IF NOT EXISTS trivia_room_answers_room_idx ON trivia_room_answers(room_code, question_index);
