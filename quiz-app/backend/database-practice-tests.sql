CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

CREATE INDEX IF NOT EXISTS idx_question_banks_user_id ON question_banks(user_id);
CREATE INDEX IF NOT EXISTS idx_banked_questions_bank_id ON banked_questions(bank_id);
CREATE INDEX IF NOT EXISTS idx_practice_tests_user_id ON practice_tests(user_id);
CREATE INDEX IF NOT EXISTS idx_practice_test_attempts_test_id ON practice_test_attempts(test_id);
CREATE INDEX IF NOT EXISTS idx_practice_test_attempts_user_id ON practice_test_attempts(user_id);

ALTER TABLE question_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE banked_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_test_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own question banks" ON question_banks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create question banks" ON question_banks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own banks" ON question_banks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own banks" ON question_banks FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view questions in their banks" ON banked_questions FOR SELECT USING (EXISTS (SELECT 1 FROM question_banks WHERE id = bank_id AND user_id = auth.uid()));
CREATE POLICY "Users can create questions in their banks" ON banked_questions FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM question_banks WHERE id = bank_id AND user_id = auth.uid()));

CREATE POLICY "Users can view own tests" ON practice_tests FOR SELECT USING (auth.uid() = user_id OR (is_shared = TRUE AND share_token IS NOT NULL));
CREATE POLICY "Users can create tests" ON practice_tests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own tests" ON practice_tests FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own tests" ON practice_tests FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own attempts" ON practice_test_attempts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create attempts" ON practice_test_attempts FOR INSERT WITH CHECK (auth.uid() = user_id);
