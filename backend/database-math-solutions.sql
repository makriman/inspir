-- Math Problem Solver Database Schema
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Math Solutions Table
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

-- Math Practice Problems Table
CREATE TABLE IF NOT EXISTS math_practice_problems (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  original_solution_id UUID REFERENCES math_solutions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_text TEXT NOT NULL,
  solution_steps JSONB NOT NULL,
  final_answer TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_math_solutions_user_id ON math_solutions(user_id);
CREATE INDEX IF NOT EXISTS idx_math_solutions_created_at ON math_solutions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_math_solutions_share_token ON math_solutions(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_math_practice_user_id ON math_practice_problems(user_id);

ALTER TABLE math_solutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE math_practice_problems ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own solutions" ON math_solutions FOR SELECT USING (auth.uid() = user_id OR (is_shared = TRUE AND share_token IS NOT NULL));
CREATE POLICY "Users can create solutions" ON math_solutions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own solutions" ON math_solutions FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Guests can create solutions" ON math_solutions FOR INSERT WITH CHECK (user_id IS NULL);
CREATE POLICY "Users can view own practice" ON math_practice_problems FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create practice" ON math_practice_problems FOR INSERT WITH CHECK (auth.uid() = user_id);
