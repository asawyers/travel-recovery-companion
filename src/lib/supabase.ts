import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_CONFIG } from '@/config/public-supabase';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || PUBLIC_SUPABASE_CONFIG.url,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || PUBLIC_SUPABASE_CONFIG.publishableKey,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

/** The public project key identifies the project; only a real session authorizes a user. */
export async function getAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const { data, error } = await supabase.auth.getSession();
    return error ? null : data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
