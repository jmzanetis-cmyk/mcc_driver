// ============================================================
// MCC Driver — Supabase Client
// ============================================================
// NOTE: Once you run `supabase gen types typescript`, uncomment
// the Database import and add it to createClient<Database>().
// Until then, the client is untyped to avoid 'never' errors.
// ============================================================

import { createClient } from '@supabase/supabase-js';
// import type { Database } from '@/types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[MCC Driver] Missing Supabase env vars.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});

export default supabase;
