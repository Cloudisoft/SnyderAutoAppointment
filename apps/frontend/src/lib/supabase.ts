import { createClient } from '@supabase/supabase-js';

// Browser client: anon key only. All privileged work goes through the backend API.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? 'http://localhost:54321',
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'anon',
  { auth: { persistSession: true, autoRefreshToken: true } },
);
