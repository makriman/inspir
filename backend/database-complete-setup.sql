-- ============================================
-- COMPLETE DATABASE SETUP FOR INSPIR
-- All features: Citations, Cornell Notes, Study Streaks,
-- Doubt Solver, Waitlist
-- Run this in Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. CITATION GENERATOR
-- ============================================

-- Table to store generated citations
CREATE TABLE IF NOT EXISTS citations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    citation_type VARCHAR(50) NOT NULL, -- 'book', 'article', 'website', 'journal', etc.
    citation_style VARCHAR(20) NOT NULL, -- 'MLA', 'APA', 'Chicago', 'Harvard'
    source_data JSONB NOT NULL, -- All source information (title, author, date, etc.)
    formatted_citation TEXT NOT NULL, -- The formatted citation string
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table to store citation projects/collections
CREATE TABLE IF NOT EXISTS citation_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    project_name VARCHAR(255) NOT NULL,
    description TEXT,
    default_style VARCHAR(20) DEFAULT 'MLA',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Junction table for citations in projects
CREATE TABLE IF NOT EXISTS project_citations (
    project_id UUID REFERENCES citation_projects(id) ON DELETE CASCADE,
    citation_id UUID REFERENCES citations(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (project_id, citation_id)
);

-- Indexes for citations
CREATE INDEX IF NOT EXISTS idx_citations_user_id ON citations(user_id);
CREATE INDEX IF NOT EXISTS idx_citations_created_at ON citations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_citation_projects_user_id ON citation_projects(user_id);

-- ============================================
-- 2. CORNELL NOTES GENERATOR
-- ============================================

-- Table to store Cornell notes
CREATE TABLE IF NOT EXISTS cornell_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    subject VARCHAR(100),
    source_content TEXT, -- Original content that was processed
    cues TEXT, -- Cue questions/keywords (changed from JSONB to TEXT)
    notes TEXT, -- Main notes section (changed from JSONB to TEXT)
    summary TEXT, -- Summary section at bottom
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for Cornell notes
CREATE INDEX IF NOT EXISTS idx_cornell_notes_user_id ON cornell_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_cornell_notes_subject ON cornell_notes(subject);
CREATE INDEX IF NOT EXISTS idx_cornell_notes_created_at ON cornell_notes(created_at DESC);

-- ============================================
-- 3. STUDY STREAKS & ACTIVITY TRACKING
-- ============================================

-- Table to track daily study activity
CREATE TABLE IF NOT EXISTS study_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    activity_date DATE NOT NULL,
    activity_type VARCHAR(50) NOT NULL, -- 'quiz', 'timer', 'notes', 'citation', 'doubt', etc.
    activity_count INTEGER DEFAULT 1,
    total_time_minutes INTEGER DEFAULT 0, -- For timer sessions
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, activity_date, activity_type)
);

-- Table to store streak statistics
CREATE TABLE IF NOT EXISTS user_streaks (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    total_study_days INTEGER DEFAULT 0,
    last_activity_date DATE,
    streak_freeze_count INTEGER DEFAULT 0, -- Number of freeze days available
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for study activity
CREATE INDEX IF NOT EXISTS idx_study_activity_user_id ON study_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_study_activity_date ON study_activity(activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_study_activity_user_date ON study_activity(user_id, activity_date);

-- ============================================
-- 4. DOUBT SOLVER (HOMEWORK HELPER)
-- ============================================

-- Stores user questions (text or image-based)
CREATE TABLE IF NOT EXISTS doubt_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

-- Stores shareable links for solutions
CREATE TABLE IF NOT EXISTS doubt_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doubt_id UUID NOT NULL REFERENCES doubt_questions(id) ON DELETE CASCADE,
  share_token VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE, -- Optional expiration
  views_count INTEGER DEFAULT 0
);

-- Indexes for doubt solver
CREATE INDEX IF NOT EXISTS idx_doubt_questions_user_id ON doubt_questions(user_id);
CREATE INDEX IF NOT EXISTS idx_doubt_questions_subject ON doubt_questions(subject);
CREATE INDEX IF NOT EXISTS idx_doubt_questions_created_at ON doubt_questions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_doubt_questions_public ON doubt_questions(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_doubt_shares_token ON doubt_shares(share_token);
CREATE INDEX IF NOT EXISTS idx_doubt_shares_doubt_id ON doubt_shares(doubt_id);

-- ============================================
-- 5. WAITLIST (COMING SOON TOOLS)
-- ============================================

-- Create waitlist table for coming soon tools
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  tool_name VARCHAR(255) NOT NULL,
  tool_id VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_waitlist_tool_id ON waitlist(tool_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_email_tool ON waitlist(email, tool_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE citation_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cornell_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE doubt_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE doubt_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Citations policies
CREATE POLICY "Users can view their own citations" ON citations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own citations" ON citations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own citations" ON citations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own citations" ON citations FOR DELETE USING (auth.uid() = user_id);

-- Citation projects policies
CREATE POLICY "Users can view their own citation projects" ON citation_projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own citation projects" ON citation_projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own citation projects" ON citation_projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own citation projects" ON citation_projects FOR DELETE USING (auth.uid() = user_id);

-- Project citations policies
CREATE POLICY "Users can view their project citations" ON project_citations FOR SELECT
  USING (EXISTS (SELECT 1 FROM citation_projects WHERE citation_projects.id = project_citations.project_id AND citation_projects.user_id = auth.uid()));
CREATE POLICY "Users can manage their project citations" ON project_citations FOR ALL
  USING (EXISTS (SELECT 1 FROM citation_projects WHERE citation_projects.id = project_citations.project_id AND citation_projects.user_id = auth.uid()));

-- Cornell notes policies
CREATE POLICY "Users can view their own Cornell notes" ON cornell_notes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own Cornell notes" ON cornell_notes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own Cornell notes" ON cornell_notes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own Cornell notes" ON cornell_notes FOR DELETE USING (auth.uid() = user_id);

-- Study activity policies
CREATE POLICY "Users can view their own study activity" ON study_activity FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own study activity" ON study_activity FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own study activity" ON study_activity FOR UPDATE USING (auth.uid() = user_id);

-- User streaks policies
CREATE POLICY "Users can view their own streaks" ON user_streaks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own streaks" ON user_streaks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own streaks" ON user_streaks FOR UPDATE USING (auth.uid() = user_id);

-- Doubt questions policies
CREATE POLICY "Users can view their own doubts" ON doubt_questions FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "Users can insert their own doubts" ON doubt_questions FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "Users can update their own doubts" ON doubt_questions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own doubts" ON doubt_questions FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Public doubts are viewable by all" ON doubt_questions FOR SELECT USING (is_public = true);

-- Doubt shares policies
CREATE POLICY "Users can view their own shares" ON doubt_shares FOR SELECT
  USING (EXISTS (SELECT 1 FROM doubt_questions WHERE doubt_questions.id = doubt_shares.doubt_id AND doubt_questions.user_id = auth.uid()));
CREATE POLICY "Users can create shares for their doubts" ON doubt_shares FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM doubt_questions WHERE doubt_questions.id = doubt_shares.doubt_id AND doubt_questions.user_id = auth.uid()));
CREATE POLICY "Anyone can view shares" ON doubt_shares FOR SELECT USING (true);

-- Waitlist policies (public access for signups)
CREATE POLICY "Anyone can add to waitlist" ON waitlist FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can view waitlist entries" ON waitlist FOR SELECT USING (true);

-- ============================================
-- HELPER FUNCTIONS & TRIGGERS
-- ============================================

-- Function to update streak when activity is logged
CREATE OR REPLACE FUNCTION update_user_streak(p_user_id UUID, p_activity_date DATE)
RETURNS void AS $$
DECLARE
    v_current_streak INTEGER := 0;
    v_longest_streak INTEGER := 0;
    v_total_days INTEGER := 0;
    v_last_date DATE;
BEGIN
    -- Get current streak data
    SELECT current_streak, longest_streak, total_study_days, last_activity_date
    INTO v_current_streak, v_longest_streak, v_total_days, v_last_date
    FROM user_streaks
    WHERE user_id = p_user_id;

    -- If no record exists, create one
    IF NOT FOUND THEN
        INSERT INTO user_streaks (user_id, current_streak, longest_streak, total_study_days, last_activity_date)
        VALUES (p_user_id, 1, 1, 1, p_activity_date);
        RETURN;
    END IF;

    -- If activity is on the same day, don't update streak
    IF v_last_date = p_activity_date THEN
        RETURN;
    END IF;

    -- Calculate consecutive days
    IF v_last_date = p_activity_date - INTERVAL '1 day' THEN
        -- Consecutive day
        v_current_streak := v_current_streak + 1;
    ELSIF v_last_date < p_activity_date - INTERVAL '1 day' THEN
        -- Streak broken
        v_current_streak := 1;
    END IF;

    -- Update longest streak if current is higher
    IF v_current_streak > v_longest_streak THEN
        v_longest_streak := v_current_streak;
    END IF;

    -- Increment total study days
    v_total_days := v_total_days + 1;

    -- Update the record
    UPDATE user_streaks
    SET current_streak = v_current_streak,
        longest_streak = v_longest_streak,
        total_study_days = v_total_days,
        last_activity_date = p_activity_date,
        updated_at = NOW()
    WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update streak when study activity is logged
CREATE OR REPLACE FUNCTION trigger_update_streak()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM update_user_streak(NEW.user_id, NEW.activity_date);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS study_activity_streak_update ON study_activity;
CREATE TRIGGER study_activity_streak_update
    AFTER INSERT ON study_activity
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_streak();

-- Function to update doubt questions updated_at
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

-- Function to generate random share token
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

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE citations IS 'Stores user-generated citations in various formats';
COMMENT ON TABLE cornell_notes IS 'Stores Cornell-style structured notes';
COMMENT ON TABLE study_activity IS 'Tracks daily study activities for streak calculation';
COMMENT ON TABLE user_streaks IS 'Stores streak statistics for gamification';
COMMENT ON TABLE doubt_questions IS 'Stores student questions and AI-generated solutions';
COMMENT ON TABLE waitlist IS 'Stores email addresses for users interested in coming soon tools';

-- ============================================
-- SETUP COMPLETE!
-- ============================================

-- Verify tables were created
SELECT
  schemaname,
  tablename,
  tableowner
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN (
  'citations', 'citation_projects', 'project_citations',
  'cornell_notes', 'study_activity', 'user_streaks',
  'doubt_questions', 'doubt_shares',
  'waitlist'
)
ORDER BY tablename;
