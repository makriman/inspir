import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Ensure environment variables are loaded before creating clients.
// In Node ESM, module evaluation order can cause server.js to load after this module,
// so we load env here as well (safe and idempotent).
dotenv.config({ path: '/root/quiz-app/backend/.env.local' });
dotenv.config({ path: '/root/quiz-app/backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const supabaseAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

export function getSupabaseAdminOrThrow() {
  if (!supabaseAdmin) {
    const error = new Error(
      'Chat database is not configured: SUPABASE_SERVICE_ROLE_KEY is missing (required to bypass RLS for server-side operations).'
    );
    error.code = 'SUPABASE_SERVICE_ROLE_KEY_MISSING';
    throw error;
  }
  return supabaseAdmin;
}
