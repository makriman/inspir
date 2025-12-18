-- Database schema for Doubt Solver (Homework Helper) feature
-- This creates tables for storing questions, solutions, and sharing functionality

-- =============================================
-- DOUBT QUESTIONS TABLE
-- Stores user questions (text or image-based)
-- =============================================

CREATE TABLE IF NOT EXISTS doubt_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Question details
  question_text TEXT NOT NULL,
  subject VARCHAR(50), -- e.g., Mathematics, Physics, Chemistry, Biology, Other
  source_type VARCHAR(20) NOT NULL, -- 'text' or 'image'
  image_url TEXT, -- URL to uploaded image if source_type is 'image'
  extracted_text TEXT, -- OCR extracted text from image

  -- Solution
  solution_text TEXT,
  solution_steps JSONB, -- Array of step-by-step solution
  key_concepts TEXT[], -- Array of key concepts used
  estimated_difficulty VARCHAR(20), -- 'Easy', 'Medium', 'Hard'

  -- Metadata
  is_public BOOLEAN DEFAULT false, -- Whether to show in "Recent Solutions"
  views_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- DOUBT SHARES TABLE
-- Stores shareable links for solutions
-- =============================================

CREATE TABLE IF NOT EXISTS doubt_shares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  doubt_id UUID NOT NULL REFERENCES doubt_questions(id) ON DELETE CASCADE,
  share_token VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE, -- Optional expiration
  views_count INTEGER DEFAULT 0
);

-- =============================================
-- INDEXES FOR PERFORMANCE
-- =============================================

CREATE INDEX IF NOT EXISTS idx_doubt_questions_user_id ON doubt_questions(user_id);
CREATE INDEX IF NOT EXISTS idx_doubt_questions_subject ON doubt_questions(subject);
CREATE INDEX IF NOT EXISTS idx_doubt_questions_created_at ON doubt_questions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_doubt_questions_public ON doubt_questions(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_doubt_shares_token ON doubt_shares(share_token);
CREATE INDEX IF NOT EXISTS idx_doubt_shares_doubt_id ON doubt_shares(doubt_id);

-- =============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================

-- Enable RLS
ALTER TABLE doubt_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE doubt_shares ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view their own doubts" ON doubt_questions;
DROP POLICY IF EXISTS "Users can insert their own doubts" ON doubt_questions;
DROP POLICY IF EXISTS "Users can update their own doubts" ON doubt_questions;
DROP POLICY IF EXISTS "Users can delete their own doubts" ON doubt_questions;
DROP POLICY IF EXISTS "Public doubts are viewable by all" ON doubt_questions;
DROP POLICY IF EXISTS "Users can view their own shares" ON doubt_shares;
DROP POLICY IF EXISTS "Users can create shares for their doubts" ON doubt_shares;
DROP POLICY IF EXISTS "Anyone can view shares" ON doubt_shares;

-- Doubt Questions Policies
-- Users can view their own doubts
CREATE POLICY "Users can view their own doubts"
  ON doubt_questions
  FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Users can insert their own doubts (or anonymous users can insert with NULL user_id)
CREATE POLICY "Users can insert their own doubts"
  ON doubt_questions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Users can update their own doubts
CREATE POLICY "Users can update their own doubts"
  ON doubt_questions
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own doubts
CREATE POLICY "Users can delete their own doubts"
  ON doubt_questions
  FOR DELETE
  USING (auth.uid() = user_id);

-- Public doubts are viewable by all (for "Recent Solutions")
CREATE POLICY "Public doubts are viewable by all"
  ON doubt_questions
  FOR SELECT
  USING (is_public = true);

-- Doubt Shares Policies
-- Users can view shares for their own doubts
CREATE POLICY "Users can view their own shares"
  ON doubt_shares
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM doubt_questions
      WHERE doubt_questions.id = doubt_shares.doubt_id
      AND doubt_questions.user_id = auth.uid()
    )
  );

-- Users can create shares for their own doubts
CREATE POLICY "Users can create shares for their doubts"
  ON doubt_shares
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM doubt_questions
      WHERE doubt_questions.id = doubt_shares.doubt_id
      AND doubt_questions.user_id = auth.uid()
    )
  );

-- Anyone can view shares by token (for shared links)
CREATE POLICY "Anyone can view shares"
  ON doubt_shares
  FOR SELECT
  USING (true);

-- =============================================
-- TRIGGER: Update updated_at timestamp
-- =============================================

CREATE OR REPLACE FUNCTION update_doubt_questions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_doubt_questions_updated_at_trigger ON doubt_questions;

CREATE TRIGGER update_doubt_questions_updated_at_trigger
  BEFORE UPDATE ON doubt_questions
  FOR EACH ROW
  EXECUTE FUNCTION update_doubt_questions_updated_at();

-- =============================================
-- FUNCTION: Generate random share token
-- =============================================

CREATE OR REPLACE FUNCTION generate_share_token()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..12 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- ACTIVITY TRACKING FOR STREAKS
-- =============================================

-- Update study_activities trigger to track doubt solver usage
-- (This integrates with the existing streaks system)

CREATE OR REPLACE FUNCTION track_doubt_activity()
RETURNS TRIGGER AS $$
BEGIN
  -- Only track if user is authenticated
  IF NEW.user_id IS NOT NULL THEN
    INSERT INTO study_activities (user_id, activity_type, activity_date)
    VALUES (NEW.user_id, 'doubt', CURRENT_DATE)
    ON CONFLICT (user_id, activity_date, activity_type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS track_doubt_activity_trigger ON doubt_questions;

CREATE TRIGGER track_doubt_activity_trigger
  AFTER INSERT ON doubt_questions
  FOR EACH ROW
  EXECUTE FUNCTION track_doubt_activity();

-- =============================================
-- MIGRATION COMPLETE
-- =============================================

-- Grant necessary permissions
GRANT ALL ON doubt_questions TO authenticated;
GRANT ALL ON doubt_shares TO authenticated;
GRANT SELECT ON doubt_questions TO anon;
GRANT SELECT ON doubt_shares TO anon;
