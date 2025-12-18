-- Text Summarizer Database Schema
-- This file creates the necessary tables for the text summarization feature

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Text Summaries Table
CREATE TABLE IF NOT EXISTS text_summaries (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  original_content TEXT,
  summary_text TEXT NOT NULL,
  key_concepts JSONB DEFAULT '[]'::jsonb,
  summary_length TEXT NOT NULL CHECK (summary_length IN ('short', 'medium', 'long')),
  output_format TEXT NOT NULL CHECK (output_format IN ('bullets', 'paragraph')),
  word_count JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_text_summaries_user_id ON text_summaries(user_id);
CREATE INDEX IF NOT EXISTS idx_text_summaries_created_at ON text_summaries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_text_summaries_summary_length ON text_summaries(summary_length);

-- Enable Row Level Security
ALTER TABLE text_summaries ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view their own summaries
CREATE POLICY "Users can view own summaries"
  ON text_summaries FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create summaries
CREATE POLICY "Users can create summaries"
  ON text_summaries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own summaries
CREATE POLICY "Users can update own summaries"
  ON text_summaries FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own summaries
CREATE POLICY "Users can delete own summaries"
  ON text_summaries FOR DELETE
  USING (auth.uid() = user_id);

-- Allow guests to create summaries (user_id can be NULL)
CREATE POLICY "Guests can create summaries"
  ON text_summaries FOR INSERT
  WITH CHECK (user_id IS NULL);
