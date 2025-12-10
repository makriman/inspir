-- Quiz Generation App Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Quizzes table
CREATE TABLE IF NOT EXISTS quizzes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  questions JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Quiz results table
CREATE TABLE IF NOT EXISTS quiz_results (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  quiz_id UUID REFERENCES quizzes(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  percentage INTEGER NOT NULL,
  answers JSONB NOT NULL,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_quizzes_user_id ON quizzes(user_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_created_at ON quizzes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_results_user_id ON quiz_results(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_results_quiz_id ON quiz_results(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_results_submitted_at ON quiz_results(submitted_at DESC);

-- Enable Row Level Security
ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_results ENABLE ROW LEVEL SECURITY;

-- Policies for quizzes table
CREATE POLICY "Users can view their own quizzes"
  ON quizzes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create quizzes"
  ON quizzes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own quizzes"
  ON quizzes FOR DELETE
  USING (auth.uid() = user_id);

-- Policies for quiz_results table
CREATE POLICY "Users can view their own results"
  ON quiz_results FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create results"
  ON quiz_results FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own results"
  ON quiz_results FOR DELETE
  USING (auth.uid() = user_id);
