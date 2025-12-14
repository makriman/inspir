-- Waitlist table for coming soon tools
-- Run this SQL in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  tool_name VARCHAR(255) NOT NULL,
  tool_id VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_waitlist_tool_id ON waitlist(tool_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_email_tool ON waitlist(email, tool_id);

-- Enable Row Level Security
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can add to waitlist (no auth required)
CREATE POLICY "Anyone can add to waitlist"
  ON waitlist
  FOR INSERT
  WITH CHECK (true);

-- Policy: Only admins can view waitlist (optional - you can remove this if you want public viewing)
CREATE POLICY "Public can view own waitlist entries"
  ON waitlist
  FOR SELECT
  USING (true);

COMMENT ON TABLE waitlist IS 'Stores email addresses for users interested in coming soon tools';
