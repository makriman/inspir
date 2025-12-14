import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

// Create Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function createWaitlistTable() {
  console.log('🔄 Creating waitlist table in Supabase...\n');

  try {
    // First, let's try to insert a test row to see if table exists
    const { data: testData, error: testError } = await supabase
      .from('waitlist')
      .select('id')
      .limit(1);

    if (!testError) {
      console.log('✅ Waitlist table already exists!');
      console.log('📊 Current entries:', testData?.length || 0);
      return;
    }

    if (testError.code === '42P01' || testError.code === 'PGRST205' || testError.message.includes('does not exist') || testError.message.includes('schema cache')) {
      console.log('❌ Waitlist table does not exist.');
      console.log('\n📋 MANUAL SETUP REQUIRED:\n');
      console.log('Please run this SQL in your Supabase SQL Editor:');
      console.log('(Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new)\n');
      console.log('─'.repeat(80));
      console.log(`
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

-- Enable Row Level Security
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can add to waitlist (no auth required)
CREATE POLICY "Anyone can add to waitlist"
  ON waitlist
  FOR INSERT
  WITH CHECK (true);

-- Policy: Public can view entries
CREATE POLICY "Public can view waitlist entries"
  ON waitlist
  FOR SELECT
  USING (true);

COMMENT ON TABLE waitlist IS 'Stores email addresses for users interested in coming soon tools';
      `);
      console.log('─'.repeat(80));
      console.log('\n📝 Instructions:');
      console.log('1. Copy the SQL above');
      console.log('2. Go to Supabase Dashboard → SQL Editor');
      console.log('3. Paste and run the SQL');
      console.log('4. Verify table appears in Table Editor\n');

      // Get the project ID from URL
      const projectRef = process.env.SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
      if (projectRef) {
        console.log(`🔗 Direct link: https://supabase.com/dashboard/project/${projectRef}/sql/new\n`);
      }

      process.exit(1);
    } else {
      console.error('❌ Unexpected error:', testError);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

createWaitlistTable();
