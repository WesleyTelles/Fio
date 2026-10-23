// Variáveis PÚBLICAS (embutidas no bundle). Só URL e chave anônima do Supabase.
// A chave anônima é segura para o cliente SOMENTE porque o RLS protege todas as tabelas.
// NUNCA coloque service_role, chaves de IA ou senhas aqui.
const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const config = {
  supabaseUrl: url,
  supabaseAnonKey: anon,
  ok: /^https?:\/\//.test(url) && anon.length > 20,
  appName: 'Fio',
  buildId: (import.meta.env.VITE_BUILD_ID ?? 'dev') as string,
};
