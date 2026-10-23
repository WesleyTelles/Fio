import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

let client: SupabaseClient | null = null;
/** Cliente único. Toda requisição tem timeout (rede móvel instável não pode travar a UI). */
export function supabase(): SupabaseClient {
  if (!config.ok) throw new Error('config');
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) }) },
    });
  }
  return client;
}
