-- Student Q&A Forum Database Schema
-- Stack Overflow-like forum for students
-- Run this in your Supabase SQL Editor

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Forum questions table
CREATE TABLE IF NOT EXISTS forum_questions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Forum answers table
CREATE TABLE IF NOT EXISTS forum_answers (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  question_id UUID REFERENCES forum_questions(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Forum votes table (for upvoting answers)
CREATE TABLE IF NOT EXISTS forum_votes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  answer_id UUID REFERENCES forum_answers(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(answer_id, user_id) -- One vote per user per answer
);

-- User reputation table (track reputation points)
CREATE TABLE IF NOT EXISTS user_reputation (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE PRIMARY KEY,
  reputation INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_forum_questions_user_id ON forum_questions(user_id);
CREATE INDEX IF NOT EXISTS idx_forum_questions_created_at ON forum_questions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_questions_tags ON forum_questions USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_forum_answers_question_id ON forum_answers(question_id);
CREATE INDEX IF NOT EXISTS idx_forum_answers_user_id ON forum_answers(user_id);
CREATE INDEX IF NOT EXISTS idx_forum_answers_created_at ON forum_answers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_votes_answer_id ON forum_votes(answer_id);
CREATE INDEX IF NOT EXISTS idx_forum_votes_user_id ON forum_votes(user_id);

-- Enable Row Level Security
ALTER TABLE forum_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_reputation ENABLE ROW LEVEL SECURITY;

-- Policies for forum_questions (everyone can read, only authenticated users can create)
CREATE POLICY "Anyone can view questions"
  ON forum_questions FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can create questions"
  ON forum_questions FOR INSERT
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Users can update their own questions"
  ON forum_questions FOR UPDATE
  USING (auth.uid()::uuid = user_id);

CREATE POLICY "Users can delete their own questions"
  ON forum_questions FOR DELETE
  USING (auth.uid()::uuid = user_id);

-- Policies for forum_answers
CREATE POLICY "Anyone can view answers"
  ON forum_answers FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can create answers"
  ON forum_answers FOR INSERT
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Users can update their own answers"
  ON forum_answers FOR UPDATE
  USING (auth.uid()::uuid = user_id);

CREATE POLICY "Users can delete their own answers"
  ON forum_answers FOR DELETE
  USING (auth.uid()::uuid = user_id);

-- Policies for forum_votes
CREATE POLICY "Anyone can view votes"
  ON forum_votes FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can vote"
  ON forum_votes FOR INSERT
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Users can delete their own votes"
  ON forum_votes FOR DELETE
  USING (auth.uid()::uuid = user_id);

-- Policies for user_reputation
CREATE POLICY "Anyone can view reputation"
  ON user_reputation FOR SELECT
  USING (true);

CREATE POLICY "System can update reputation"
  ON user_reputation FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update reputation values"
  ON user_reputation FOR UPDATE
  USING (true);

-- Function to update reputation when answer gets upvoted
CREATE OR REPLACE FUNCTION update_reputation_on_vote()
RETURNS TRIGGER AS $$
BEGIN
  -- Add 10 reputation points to the answer author
  INSERT INTO user_reputation (user_id, reputation)
  SELECT user_id, 10
  FROM forum_answers
  WHERE id = NEW.answer_id
  ON CONFLICT (user_id)
  DO UPDATE SET reputation = user_reputation.reputation + 10, updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to decrease reputation when vote is removed
CREATE OR REPLACE FUNCTION decrease_reputation_on_vote_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Remove 10 reputation points from the answer author
  UPDATE user_reputation
  SET reputation = GREATEST(0, reputation - 10), updated_at = NOW()
  WHERE user_id = (SELECT user_id FROM forum_answers WHERE id = OLD.answer_id);

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Function to add small reputation when answer is posted
CREATE OR REPLACE FUNCTION add_reputation_on_answer()
RETURNS TRIGGER AS $$
BEGIN
  -- Add 2 reputation points to the answer author
  INSERT INTO user_reputation (user_id, reputation)
  VALUES (NEW.user_id, 2)
  ON CONFLICT (user_id)
  DO UPDATE SET reputation = user_reputation.reputation + 2, updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for reputation updates
DROP TRIGGER IF EXISTS trigger_reputation_on_vote ON forum_votes;
CREATE TRIGGER trigger_reputation_on_vote
  AFTER INSERT ON forum_votes
  FOR EACH ROW
  EXECUTE FUNCTION update_reputation_on_vote();

DROP TRIGGER IF EXISTS trigger_reputation_on_vote_delete ON forum_votes;
CREATE TRIGGER trigger_reputation_on_vote_delete
  AFTER DELETE ON forum_votes
  FOR EACH ROW
  EXECUTE FUNCTION decrease_reputation_on_vote_delete();

DROP TRIGGER IF EXISTS trigger_reputation_on_answer ON forum_answers;
CREATE TRIGGER trigger_reputation_on_answer
  AFTER INSERT ON forum_answers
  FOR EACH ROW
  EXECUTE FUNCTION add_reputation_on_answer();
