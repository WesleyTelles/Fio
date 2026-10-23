// Supabase Edge Function: POST /functions/v1/interpret
// Variáveis (somente servidor): ANTHROPIC_API_KEY, ANTHROPIC_MODEL, AI_MODE (demo|anthropic|off), ALLOWED_ORIGIN, AI_TIMEOUT_MS
// SUPABASE_URL e SUPABASE_ANON_KEY são injetadas pelo Supabase. A service_role NÃO é usada.
import { createClient } from '@supabase/supabase-js';
import { handleInterpret } from '../_shared/handler.ts';
import type { CategoryLite } from '../_shared/schema.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const userClient = (jwt: string) =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false },
  });

Deno.serve((req) => handleInterpret(req, {
  env: (k) => Deno.env.get(k),
  authenticate: async (jwt) => { const { data, error } = await userClient(jwt).auth.getUser(jwt); return error ? null : data.user?.id ?? null; },
  takeQuota: async (jwt) => {
    const { data, error } = await userClient(jwt).rpc('ai_take_quota', { p_per_minute: 8, p_per_day: 200 });
    if (error) throw new Error('quota'); return data;
  },
  loadCategories: async (jwt): Promise<CategoryLite[]> => {
    const { data, error } = await userClient(jwt).from('categories').select('id, slug, name, kind').is('archived_at', null);
    if (error) throw new Error('cats');
    return (data ?? []).map((c: any) => ({ key: c.slug ?? c.id, name: c.name, kind: c.kind }));
  },
}));
