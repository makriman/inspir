-- =============================================================================
-- inspir Application - Consolidated Database Schema
-- Run this in Supabase SQL Editor to set up all required tables
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- FLASHCARD TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS flashcard_decks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  deck_name TEXT NOT NULL,
  source_name TEXT,
  description TEXT,
  cards JSONB NOT NULL,
  card_count INTEGER NOT NULL,
  is_shared BOOLEAN DEFAULT FALSE,
  share_token UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flashcard_progress (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  deck_id UUID REFERENCES flashcard_decks(id) ON DELETE CASCADE NOT NULL,
  card_id TEXT NOT NULL,
  mastery_level INTEGER DEFAULT 0 CHECK (mastery_level >= 0 AND mastery_level <= 5),
  ease_factor DECIMAL(4,2) DEFAULT 2.50,
  interval_days INTEGER DEFAULT 0,
  last_reviewed_at TIMESTAMP WITH TIME ZONE,
  next_review_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  review_count INTEGER DEFAULT 0,
  correct_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, deck_id, card_id)
);

CREATE TABLE IF NOT EXISTS flashcard_sessions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  deck_id UUID REFERENCES flashcard_decks(id) ON DELETE CASCADE NOT NULL,
  study_mode TEXT NOT NULL CHECK (study_mode IN ('flip', 'mcq', 'type')),
  cards_studied INTEGER NOT NULL DEFAULT 0,
  cards_correct INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  session_data JSONB,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- MIND MAPS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS mind_maps (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  topic TEXT,
  nodes JSONB NOT NULL,
  edges JSONB NOT NULL,
  layout_type TEXT DEFAULT 'tree',
  viewport JSONB,
  is_shared BOOLEAN DEFAULT FALSE,
  share_token UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- CONCEPT MAPS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS concept_maps (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  topic TEXT,
  concepts JSONB NOT NULL,
  relationships JSONB NOT NULL,
  is_shared BOOLEAN DEFAULT FALSE,
  share_token UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- MATH SOLUTIONS TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS math_solutions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_text TEXT NOT NULL,
  problem_image_url TEXT,
  solution_steps JSONB NOT NULL,
  final_answer TEXT NOT NULL,
  problem_type TEXT,
  difficulty_level TEXT,
  is_shared BOOLEAN DEFAULT FALSE,
  share_token UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS math_practice_problems (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  original_solution_id UUID REFERENCES math_solutions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_text TEXT NOT NULL,
  solution_steps JSONB NOT NULL,
  final_answer TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- PRACTICE TESTS TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS question_banks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  subject TEXT,
  tags TEXT[],
  question_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS banked_questions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  bank_id UUID REFERENCES question_banks(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('mcq', 'short_answer', 'essay')),
  options JSONB,
  correct_answer TEXT,
  points INTEGER DEFAULT 1,
  explanation TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS practice_tests (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  test_name TEXT NOT NULL,
  bank_id UUID REFERENCES question_banks(id) ON DELETE SET NULL,
  questions JSONB NOT NULL,
  total_points INTEGER NOT NULL,
  time_limit_minutes INTEGER,
  is_shared BOOLEAN DEFAULT FALSE,
  share_token UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS practice_test_attempts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  test_id UUID REFERENCES practice_tests(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  answers JSONB NOT NULL,
  score INTEGER,
  max_score INTEGER,
  time_taken_seconds INTEGER,
  ai_feedback JSONB,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- STUDY GUIDES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS study_guides (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT,
  source_materials TEXT[],
  structure JSONB NOT NULL,
  word_count INTEGER,
  is_editable BOOLEAN DEFAULT TRUE,
  is_shared BOOLEAN DEFAULT FALSE,
  share_token UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TEXT SUMMARIES TABLE
-- =============================================================================

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

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Flashcard indexes
CREATE INDEX IF NOT EXISTS idx_flashcard_decks_user_id ON flashcard_decks(user_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_decks_share_token ON flashcard_decks(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flashcard_progress_user_deck ON flashcard_progress(user_id, deck_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_progress_next_review ON flashcard_progress(user_id, next_review_at);
CREATE INDEX IF NOT EXISTS idx_flashcard_sessions_user_id ON flashcard_sessions(user_id);

-- Mind maps indexes
CREATE INDEX IF NOT EXISTS idx_mind_maps_user_id ON mind_maps(user_id);
CREATE INDEX IF NOT EXISTS idx_mind_maps_share_token ON mind_maps(share_token) WHERE share_token IS NOT NULL;

-- Concept maps indexes
CREATE INDEX IF NOT EXISTS idx_concept_maps_user_id ON concept_maps(user_id);
CREATE INDEX IF NOT EXISTS idx_concept_maps_share_token ON concept_maps(share_token) WHERE share_token IS NOT NULL;

-- Math solutions indexes
CREATE INDEX IF NOT EXISTS idx_math_solutions_user_id ON math_solutions(user_id);
CREATE INDEX IF NOT EXISTS idx_math_practice_user_id ON math_practice_problems(user_id);

-- Practice tests indexes
CREATE INDEX IF NOT EXISTS idx_question_banks_user_id ON question_banks(user_id);
CREATE INDEX IF NOT EXISTS idx_practice_tests_user_id ON practice_tests(user_id);
CREATE INDEX IF NOT EXISTS idx_practice_test_attempts_test_id ON practice_test_attempts(test_id);

-- Study guides indexes
CREATE INDEX IF NOT EXISTS idx_study_guides_user_id ON study_guides(user_id);
CREATE INDEX IF NOT EXISTS idx_study_guides_share_token ON study_guides(share_token) WHERE share_token IS NOT NULL;

-- Text summaries indexes
CREATE INDEX IF NOT EXISTS idx_text_summaries_user_id ON text_summaries(user_id);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE flashcard_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE flashcard_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE flashcard_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mind_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE concept_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE math_solutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE math_practice_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE banked_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE text_summaries ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- RLS POLICIES (allow authenticated users to manage their own data)
-- =============================================================================

-- Generic policy pattern for user-owned tables
DO $$
DECLARE
  tables TEXT[] := ARRAY[
    'flashcard_decks', 'flashcard_progress', 'flashcard_sessions',
    'mind_maps', 'concept_maps', 'math_solutions', 'math_practice_problems',
    'question_banks', 'practice_tests', 'practice_test_attempts',
    'study_guides', 'text_summaries'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Drop existing policies if they exist (to avoid conflicts)
    EXECUTE format('DROP POLICY IF EXISTS "Users can view own %s" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Users can create %s" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Users can update own %s" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Users can delete own %s" ON %I', t, t);
    
    -- Create policies
    EXECUTE format('CREATE POLICY "Users can view own %s" ON %I FOR SELECT USING (auth.uid() = user_id)', t, t);
    EXECUTE format('CREATE POLICY "Users can create %s" ON %I FOR INSERT WITH CHECK (auth.uid() = user_id)', t, t);
    EXECUTE format('CREATE POLICY "Users can update own %s" ON %I FOR UPDATE USING (auth.uid() = user_id)', t, t);
    EXECUTE format('CREATE POLICY "Users can delete own %s" ON %I FOR DELETE USING (auth.uid() = user_id)', t, t);
  END LOOP;
END $$;

-- Additional policies for shared content
CREATE POLICY "View shared flashcard_decks" ON flashcard_decks FOR SELECT USING (is_shared = TRUE AND share_token IS NOT NULL);
CREATE POLICY "View shared mind_maps" ON mind_maps FOR SELECT USING (is_shared = TRUE AND share_token IS NOT NULL);
CREATE POLICY "View shared concept_maps" ON concept_maps FOR SELECT USING (is_shared = TRUE AND share_token IS NOT NULL);
CREATE POLICY "View shared math_solutions" ON math_solutions FOR SELECT USING (is_shared = TRUE AND share_token IS NOT NULL);
CREATE POLICY "View shared practice_tests" ON practice_tests FOR SELECT USING (is_shared = TRUE AND share_token IS NOT NULL);
CREATE POLICY "View shared study_guides" ON study_guides FOR SELECT USING (is_shared = TRUE AND share_token IS NOT NULL);

-- =============================================================================
-- SUCCESS MESSAGE
-- =============================================================================
SELECT 'All tables created successfully! inspir database is ready.' as status;
