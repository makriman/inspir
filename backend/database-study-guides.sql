-- Study Guide Generator Database Schema
-- This file creates the necessary tables for the study guide generation feature

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Study Guides Table
CREATE TABLE IF NOT EXISTS study_guides (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT,
  source_materials TEXT[], -- Array of original file names
  structure JSONB NOT NULL, -- { overview, keyConcepts, definitions, examples, questions, summary }
  word_count INTEGER,
  is_editable BOOLEAN DEFAULT TRUE,
  is_shared BOOLEAN DEFAULT FALSE,
  share_token UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_study_guides_user_id ON study_guides(user_id);
CREATE INDEX IF NOT EXISTS idx_study_guides_created_at ON study_guides(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_guides_subject ON study_guides(subject);
CREATE INDEX IF NOT EXISTS idx_study_guides_share_token ON study_guides(share_token) WHERE share_token IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE study_guides ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view their own study guides
CREATE POLICY "Users can view own study guides"
  ON study_guides FOR SELECT
  USING (auth.uid() = user_id OR (is_shared = TRUE AND share_token IS NOT NULL));

-- Users can create study guides
CREATE POLICY "Users can create study guides"
  ON study_guides FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own study guides
CREATE POLICY "Users can update own study guides"
  ON study_guides FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own study guides
CREATE POLICY "Users can delete own study guides"
  ON study_guides FOR DELETE
  USING (auth.uid() = user_id);

-- Allow guests to create study guides (user_id can be NULL)
CREATE POLICY "Guests can create study guides"
  ON study_guides FOR INSERT
  WITH CHECK (user_id IS NULL);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_study_guides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS study_guides_updated_at ON study_guides;
CREATE TRIGGER study_guides_updated_at
  BEFORE UPDATE ON study_guides
  FOR EACH ROW
  EXECUTE FUNCTION update_study_guides_updated_at();
