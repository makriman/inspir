-- Fix Row Level Security policies for JWT authentication
-- The original policies used auth.uid() which doesn't work with custom JWT auth
-- We need to disable RLS or use service role key

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view questions" ON forum_questions;
DROP POLICY IF EXISTS "Authenticated users can create questions" ON forum_questions;
DROP POLICY IF EXISTS "Users can update their own questions" ON forum_questions;
DROP POLICY IF EXISTS "Users can delete their own questions" ON forum_questions;

DROP POLICY IF EXISTS "Anyone can view answers" ON forum_answers;
DROP POLICY IF EXISTS "Authenticated users can create answers" ON forum_answers;
DROP POLICY IF EXISTS "Users can update their own answers" ON forum_answers;
DROP POLICY IF EXISTS "Users can delete their own answers" ON forum_answers;

DROP POLICY IF EXISTS "Anyone can view votes" ON forum_votes;
DROP POLICY IF EXISTS "Authenticated users can vote" ON forum_votes;
DROP POLICY IF EXISTS "Users can delete their own votes" ON forum_votes;

DROP POLICY IF EXISTS "Anyone can view reputation" ON user_reputation;
DROP POLICY IF EXISTS "System can update reputation" ON user_reputation;
DROP POLICY IF EXISTS "System can update reputation values" ON user_reputation;

-- Disable RLS for forum tables (since we're using JWT auth via backend)
-- The backend controllers already handle authentication
ALTER TABLE forum_questions DISABLE ROW LEVEL SECURITY;
ALTER TABLE forum_answers DISABLE ROW LEVEL SECURITY;
ALTER TABLE forum_votes DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_reputation DISABLE ROW LEVEL SECURITY;

-- Alternative: If you want to keep RLS enabled but allow all operations
-- (Backend still enforces auth, RLS just allows the queries through)
/*
ALTER TABLE forum_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_reputation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations" ON forum_questions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON forum_answers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON forum_votes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON user_reputation FOR ALL USING (true) WITH CHECK (true);
*/
