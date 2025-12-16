CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

CREATE INDEX IF NOT EXISTS idx_concept_maps_user_id ON concept_maps(user_id);
CREATE INDEX IF NOT EXISTS idx_concept_maps_created_at ON concept_maps(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_concept_maps_share_token ON concept_maps(share_token) WHERE share_token IS NOT NULL;

ALTER TABLE concept_maps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own concept maps" ON concept_maps FOR SELECT USING (auth.uid() = user_id OR (is_shared = TRUE AND share_token IS NOT NULL));
CREATE POLICY "Users can create concept maps" ON concept_maps FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own concept maps" ON concept_maps FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own concept maps" ON concept_maps FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Guests can create concept maps" ON concept_maps FOR INSERT WITH CHECK (user_id IS NULL);
