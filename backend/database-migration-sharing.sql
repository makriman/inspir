-- Quiz Sharing Feature Migration
-- Run this in your Supabase SQL Editor after the initial schema

-- ============================================
-- PART 1: Update quizzes table for sharing
-- ============================================

-- Add sharing columns to quizzes table
ALTER TABLE quizzes
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by_username TEXT;

-- Create index for share_token lookups
CREATE INDEX IF NOT EXISTS idx_quizzes_share_token ON quizzes(share_token) WHERE share_token IS NOT NULL;

-- Update existing quizzes to populate created_by_username (optional - run if needed)
-- You may need to adjust this based on your users table structure
-- UPDATE quizzes SET created_by_username = (SELECT username FROM auth.users WHERE auth.users.id = quizzes.user_id);

-- ============================================
-- PART 2: Create quiz_attempts table
-- ============================================

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  attempt_name TEXT NOT NULL,
  is_guest BOOLEAN DEFAULT false,
  score INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  percentage INTEGER NOT NULL,
  answers JSONB NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_attempt_name CHECK (char_length(trim(attempt_name)) > 0 AND char_length(attempt_name) <= 50),
  CONSTRAINT valid_score CHECK (score >= 0 AND score <= total_questions),
  CONSTRAINT valid_percentage CHECK (percentage >= 0 AND percentage <= 100)
);

-- ============================================
-- PART 3: Create indexes for performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_id ON quiz_attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_id ON quiz_attempts(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_completed_at ON quiz_attempts(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_is_guest ON quiz_attempts(is_guest);

-- ============================================
-- PART 4: Row Level Security Policies
-- ============================================

-- Enable RLS on quiz_attempts
ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can create quiz attempts (for guest sharing)
CREATE POLICY "Anyone can create quiz attempts"
  ON quiz_attempts FOR INSERT
  WITH CHECK (true);

-- Policy: Quiz creators can view all attempts on their quizzes
CREATE POLICY "Quiz creators can view attempts on their quizzes"
  ON quiz_attempts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM quizzes
      WHERE quizzes.id = quiz_attempts.quiz_id
      AND quizzes.user_id = auth.uid()
    )
  );

-- Policy: Users can view their own attempts
CREATE POLICY "Users can view their own attempts"
  ON quiz_attempts FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Allow public viewing of shared quizzes (update existing policy)
DROP POLICY IF EXISTS "Users can view their own quizzes" ON quizzes;

CREATE POLICY "Users can view their own quizzes or shared quizzes"
  ON quizzes FOR SELECT
  USING (auth.uid() = user_id OR is_shared = true);

-- ============================================
-- PART 5: Helper Functions (Optional)
-- ============================================

-- Function to generate share token for a quiz
CREATE OR REPLACE FUNCTION generate_share_token(quiz_id_param UUID)
RETURNS TEXT AS $$
DECLARE
  new_token TEXT;
BEGIN
  -- Generate a new UUID as the share token
  new_token := uuid_generate_v4()::TEXT;

  -- Update the quiz with the share token and mark as shared
  UPDATE quizzes
  SET
    share_token = new_token,
    is_shared = true
  WHERE id = quiz_id_param;

  RETURN new_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get quiz attempt statistics
CREATE OR REPLACE FUNCTION get_quiz_attempt_stats(quiz_id_param UUID)
RETURNS TABLE (
  total_attempts BIGINT,
  average_score NUMERIC,
  highest_score INTEGER,
  lowest_score INTEGER,
  average_percentage NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_attempts,
    ROUND(AVG(score), 2) as average_score,
    MAX(score) as highest_score,
    MIN(score) as lowest_score,
    ROUND(AVG(percentage), 2) as average_percentage
  FROM quiz_attempts
  WHERE quiz_id = quiz_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PART 6: Sample Data Migration (Optional)
-- ============================================

-- If you want to migrate existing quiz_results to quiz_attempts for consistency
-- Uncomment and run the following:

/*
INSERT INTO quiz_attempts (quiz_id, user_id, attempt_name, is_guest, score, total_questions, percentage, answers, completed_at)
SELECT
  qr.quiz_id,
  qr.user_id,
  COALESCE(u.username, 'Anonymous') as attempt_name,
  false as is_guest,
  qr.score,
  qr.total_questions,
  qr.percentage,
  qr.answers,
  qr.submitted_at as completed_at
FROM quiz_results qr
LEFT JOIN auth.users u ON u.id = qr.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM quiz_attempts qa
  WHERE qa.quiz_id = qr.quiz_id
  AND qa.user_id = qr.user_id
  AND qa.completed_at = qr.submitted_at
);
*/

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check if all columns exist
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'quizzes' AND column_name IN ('share_token', 'is_shared', 'created_by_username');
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'quiz_attempts';

-- Check if indexes exist
-- SELECT indexname FROM pg_indexes WHERE tablename IN ('quizzes', 'quiz_attempts');

-- Check if policies exist
-- SELECT policyname, tablename FROM pg_policies WHERE tablename IN ('quizzes', 'quiz_attempts');
