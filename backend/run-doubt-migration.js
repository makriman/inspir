import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  try {
    console.log('Reading migration file...');
    const migrationSQL = readFileSync(
      join(__dirname, 'database-doubt-solver.sql'),
      'utf8'
    );

    console.log('Running migration...');
    console.log('\nNote: This migration needs to be run with elevated privileges.');
    console.log('Please run this SQL manually in the Supabase SQL Editor:\n');
    console.log('1. Go to https://supabase.com/dashboard/project/xmxpgzdsvrelcasjsdvr/sql/new');
    console.log('2. Copy and paste the SQL from backend/database-doubt-solver.sql');
    console.log('3. Click "Run" to execute the migration\n');

    // Alternative: Print the SQL to console
    console.log('='.repeat(80));
    console.log('SQL MIGRATION CONTENT:');
    console.log('='.repeat(80));
    console.log(migrationSQL);
    console.log('='.repeat(80));

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

runMigration();
