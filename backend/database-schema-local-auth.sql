-- Quiz Generation App Database Schema
-- Simple local authentication system
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Custom users table for local authentication
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Quizzes table (updated to reference custom users table)
CREATE TABLE IF NOT EXISTS quizzes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  questions JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Quiz results table (updated to reference custom users table)
CREATE TABLE IF NOT EXISTS quiz_results (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  quiz_id UUID REFERENCES quizzes(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  percentage INTEGER NOT NULL,
  answers JSONB NOT NULL,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_quizzes_user_id ON quizzes(user_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_created_at ON quizzes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_results_user_id ON quiz_results(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_results_quiz_id ON quiz_results(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_results_submitted_at ON quiz_results(submitted_at DESC);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_results ENABLE ROW LEVEL SECURITY;

-- Policies for users table
CREATE POLICY "Users can view their own profile"
  ON users FOR SELECT
  USING (id = auth.uid()::uuid);

-- Policies for quizzes table
CREATE POLICY "Users can view their own quizzes"
  ON quizzes FOR SELECT
  USING (user_id = auth.uid()::uuid);

CREATE POLICY "Users can create quizzes"
  ON quizzes FOR INSERT
  WITH CHECK (user_id = auth.uid()::uuid);

CREATE POLICY "Users can delete their own quizzes"
  ON quizzes FOR DELETE
  USING (user_id = auth.uid()::uuid);

-- Policies for quiz_results table
CREATE POLICY "Users can view their own results"
  ON quiz_results FOR SELECT
  USING (user_id = auth.uid()::uuid);

CREATE POLICY "Users can create results"
  ON quiz_results FOR INSERT
  WITH CHECK (user_id = auth.uid()::uuid);

CREATE POLICY "Users can delete their own results"
  ON quiz_results FOR DELETE
  USING (user_id = auth.uid()::uuid);
