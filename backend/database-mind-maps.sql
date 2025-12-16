CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

CREATE INDEX IF NOT EXISTS idx_mind_maps_user_id ON mind_maps(user_id);
CREATE INDEX IF NOT EXISTS idx_mind_maps_created_at ON mind_maps(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mind_maps_share_token ON mind_maps(share_token) WHERE share_token IS NOT NULL;

ALTER TABLE mind_maps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mind maps" ON mind_maps FOR SELECT USING (auth.uid() = user_id OR (is_shared = TRUE AND share_token IS NOT NULL));
CREATE POLICY "Users can create mind maps" ON mind_maps FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own mind maps" ON mind_maps FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own mind maps" ON mind_maps FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Guests can create mind maps" ON mind_maps FOR INSERT WITH CHECK (user_id IS NULL);
