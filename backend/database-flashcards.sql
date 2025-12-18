-- Flashcard Creator Database Schema
-- This file creates the necessary tables for the flashcard system with spaced repetition

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Flashcard Decks Table
CREATE TABLE IF NOT EXISTS flashcard_decks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  deck_name TEXT NOT NULL,
  source_name TEXT,
  description TEXT,
  cards JSONB NOT NULL, -- [{ id, front, back, explanation }]
  card_count INTEGER NOT NULL,
  is_shared BOOLEAN DEFAULT FALSE,
  share_token UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Flashcard Study Progress Table (implements SM-2 spaced repetition)
CREATE TABLE IF NOT EXISTS flashcard_progress (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  deck_id UUID REFERENCES flashcard_decks(id) ON DELETE CASCADE NOT NULL,
  card_id TEXT NOT NULL, -- references cards[].id in deck JSONB
  mastery_level INTEGER DEFAULT 0 CHECK (mastery_level >= 0 AND mastery_level <= 5), -- 0=new, 5=mastered
  ease_factor DECIMAL(4,2) DEFAULT 2.50, -- SM-2 algorithm ease factor
  interval_days INTEGER DEFAULT 0,
  last_reviewed_at TIMESTAMP WITH TIME ZONE,
  next_review_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  review_count INTEGER DEFAULT 0,
  correct_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, deck_id, card_id)
);

-- Flashcard Study Sessions Table
CREATE TABLE IF NOT EXISTS flashcard_sessions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  deck_id UUID REFERENCES flashcard_decks(id) ON DELETE CASCADE NOT NULL,
  study_mode TEXT NOT NULL CHECK (study_mode IN ('flip', 'mcq', 'type')),
  cards_studied INTEGER NOT NULL DEFAULT 0,
  cards_correct INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  session_data JSONB, -- Store individual card results
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_flashcard_decks_user_id ON flashcard_decks(user_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_decks_created_at ON flashcard_decks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flashcard_decks_share_token ON flashcard_decks(share_token) WHERE share_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_flashcard_progress_user_deck ON flashcard_progress(user_id, deck_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_progress_next_review ON flashcard_progress(user_id, next_review_at);
CREATE INDEX IF NOT EXISTS idx_flashcard_progress_mastery ON flashcard_progress(user_id, mastery_level);

CREATE INDEX IF NOT EXISTS idx_flashcard_sessions_user_id ON flashcard_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_sessions_deck_id ON flashcard_sessions(deck_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_sessions_completed_at ON flashcard_sessions(completed_at DESC);

-- Enable Row Level Security
ALTER TABLE flashcard_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE flashcard_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE flashcard_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for flashcard_decks
CREATE POLICY "Users can view own decks"
  ON flashcard_decks FOR SELECT
  USING (auth.uid() = user_id OR (is_shared = TRUE AND share_token IS NOT NULL));

CREATE POLICY "Users can create decks"
  ON flashcard_decks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own decks"
  ON flashcard_decks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own decks"
  ON flashcard_decks FOR DELETE
  USING (auth.uid() = user_id);

-- Allow guests to create decks (user_id can be NULL)
CREATE POLICY "Guests can create decks"
  ON flashcard_decks FOR INSERT
  WITH CHECK (user_id IS NULL);

-- RLS Policies for flashcard_progress
CREATE POLICY "Users can view own progress"
  ON flashcard_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create progress"
  ON flashcard_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own progress"
  ON flashcard_progress FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own progress"
  ON flashcard_progress FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for flashcard_sessions
CREATE POLICY "Users can view own sessions"
  ON flashcard_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create sessions"
  ON flashcard_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_flashcard_decks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS flashcard_decks_updated_at ON flashcard_decks;
CREATE TRIGGER flashcard_decks_updated_at
  BEFORE UPDATE ON flashcard_decks
  FOR EACH ROW
  EXECUTE FUNCTION update_flashcard_decks_updated_at();
