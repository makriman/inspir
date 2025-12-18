-- Chat System Database Schema
-- Student-friendly AI chat interface with safety features

-- Chat conversations table
CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'New Chat',
  folder VARCHAR(100) DEFAULT 'general', -- For organizing chats (homework, science, math, etc.)
  is_pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE NOT NULL,
  role VARCHAR(20) NOT NULL, -- 'user' or 'assistant'
  content TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Safety fields
  was_flagged BOOLEAN DEFAULT false,
  moderation_reason TEXT,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Chat folders/categories (for organization)
CREATE TABLE IF NOT EXISTS chat_folders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(20) DEFAULT 'blue', -- For UI color coding
  icon VARCHAR(50) DEFAULT 'folder',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Search index for messages (full-text search)
CREATE INDEX IF NOT EXISTS idx_chat_messages_content_search
  ON chat_messages USING gin(to_tsvector('english', content));

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_id ON chat_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated_at ON chat_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_chat_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_conversations
  SET updated_at = NOW(), last_message_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update conversation timestamp when new message is added
DROP TRIGGER IF EXISTS trigger_update_chat_timestamp ON chat_messages;
CREATE TRIGGER trigger_update_chat_timestamp
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_conversation_timestamp();

-- Row Level Security (RLS)
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_folders ENABLE ROW LEVEL SECURITY;

-- Policies: Users can only access their own data
CREATE POLICY "Users can view their own conversations" ON chat_conversations
  FOR SELECT USING (auth.uid()::uuid = user_id);

CREATE POLICY "Users can insert their own conversations" ON chat_conversations
  FOR INSERT WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Users can update their own conversations" ON chat_conversations
  FOR UPDATE USING (auth.uid()::uuid = user_id);

CREATE POLICY "Users can delete their own conversations" ON chat_conversations
  FOR DELETE USING (auth.uid()::uuid = user_id);

CREATE POLICY "Users can view messages in their conversations" ON chat_messages
  FOR SELECT USING (
    conversation_id IN (
      SELECT id FROM chat_conversations WHERE user_id = auth.uid()::uuid
    )
  );

CREATE POLICY "Users can insert messages in their conversations" ON chat_messages
  FOR INSERT WITH CHECK (
    conversation_id IN (
      SELECT id FROM chat_conversations WHERE user_id = auth.uid()::uuid
    )
  );

CREATE POLICY "Users can view their own folders" ON chat_folders
  FOR SELECT USING (auth.uid()::uuid = user_id);

CREATE POLICY "Users can insert their own folders" ON chat_folders
  FOR INSERT WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Users can update their own folders" ON chat_folders
  FOR UPDATE USING (auth.uid()::uuid = user_id);

CREATE POLICY "Users can delete their own folders" ON chat_folders
  FOR DELETE USING (auth.uid()::uuid = user_id);

-- Insert default folders for organization
-- (Run this after user signup, or create via API)
-- INSERT INTO chat_folders (user_id, name, color, icon) VALUES
--   (user_id, 'Homework Help', 'blue', '📚'),
--   (user_id, 'Science Questions', 'green', '🔬'),
--   (user_id, 'Math Problems', 'purple', '🔢'),
--   (user_id, 'History & Social Studies', 'orange', '🏛️'),
--   (user_id, 'Creative Writing', 'pink', '✍️'),
--   (user_id, 'General', 'gray', '💬');

-- Comments for documentation
COMMENT ON TABLE chat_conversations IS 'Stores user chat conversations';
COMMENT ON TABLE chat_messages IS 'Stores individual messages in conversations';
COMMENT ON TABLE chat_folders IS 'User-defined folders for organizing chats';
COMMENT ON COLUMN chat_messages.was_flagged IS 'Whether message was flagged by content moderation';
COMMENT ON COLUMN chat_messages.tokens_used IS 'Number of tokens used by Claude API';
