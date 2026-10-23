import { AiError, anthropicProvider, demoProvider, geminiProvider, interpretMessage, type Mode, type Provider } from './ai.ts';
import { isISODate, addDays } from './dates.ts';
import { MAX_TEXT, type CategoryLite } from './schema.ts';

export interface HandlerDeps {
  env: (k: string) => string | undefined;
  fetchImpl?: typeof fetch;
  /** Valida o JWT e devolve o id do usuário (ou null). Nunca confia no corpo da requisição. */
  authenticate: (jwt: string) => Promise<string | null>;
  /** Consome a cota do usuário (RPC ai_take_quota executada com o JWT dele). */
  takeQuota: (jwt: string) => Promise<{ allowed: boolean; retry_after?: number; reason?: string }>;
  /** Carrega as categorias do PRÓPRIO usuário (padrão + personalizadas) via RLS. */
  loadCategories: (jwt: string) => Promise<CategoryLite[]>;
  now?: () => Date;
}

const json = (status: number, body: unknown, cors: Record<string, string>, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors, ...extra } });
const err = (status: number, code: string, message: string, cors: Record<string, string>, extra?: Record<string, string>) =>
  json(status, { error: { code, message } }, cors, extra);

export type AiName = 'anthropic' | 'gemini';
/**
 * Qual IA usar. AI_MODE: off | demo | anthropic | gemini | ai. AI_PROVIDER (opcional) força o provedor.
 * Sem AI_MODE: usa o provedor cuja chave existir (Gemini tem preferência se ambas); sem chave nenhuma => demo.
 * Pediu IA real mas falta a chave => DESLIGA (nunca simula IA).
 */
export function resolveMode(env: (k: string) => string | undefined): { mode: 'demo' | 'ai' | 'off'; provider?: Provider; name?: AiName } {
  const m = (env('AI_MODE') ?? '').toLowerCase();
  if (m === 'off') return { mode: 'off' };
  if (m === 'demo') return { mode: 'demo', provider: demoProvider };
  const gem = env('GEMINI_API_KEY'), anth = env('ANTHROPIC_API_KEY');
  const want = (env('AI_PROVIDER') ?? (m === 'gemini' || m === 'anthropic' ? m : '')).toLowerCase();
  const name: AiName | null = want === 'gemini' ? 'gemini' : want === 'anthropic' ? 'anthropic' : gem ? 'gemini' : anth ? 'anthropic' : null;
  const key = name === 'gemini' ? gem : name === 'anthropic' ? anth : undefined;
  const requested = m === 'ai' || m === 'gemini' || m === 'anthropic' || !!want;
  if (!name || !key) return requested ? { mode: 'off' } : { mode: 'demo', provider: demoProvider };
  return { mode: 'ai', name };
}

export async function handleInterpret(req: Request, d: HandlerDeps): Promise<Response> {
  const origin = d.env('ALLOWED_ORIGIN') ?? '';
  const reqOrigin = req.headers.get('origin') ?? '';
  const cors: Record<string, string> = {
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    'access-control-allow-methods': 'GET, POST, OPTIONS', vary: 'origin',
  };
  if (origin && (origin === reqOrigin || origin === '*')) cors['access-control-allow-origin'] = origin === '*' ? '*' : reqOrigin;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST' && req.method !== 'GET') return err(405, 'method_not_allowed', 'Método não permitido.', cors);

  const auth = req.headers.get('authorization') ?? '';
  const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!jwt) return err(401, 'unauthenticated', 'Entre na sua conta para usar o assistente.', cors);
  const uid = await d.authenticate(jwt).catch(() => null);
  if (!uid) return err(401, 'unauthenticated', 'Sessão expirada. Entre novamente.', cors);

  const cfg = resolveMode(d.env);
  // Sondagem de modo (sem consumir cota nem chamar o modelo): permite à UI rotular "demonstração" antes da 1ª mensagem.
  if (req.method === 'GET') return new Response(JSON.stringify({ mode: cfg.mode }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
  if (cfg.mode === 'off') return err(503, 'ai_disabled', 'O assistente de IA está desativado. Você ainda pode registrar manualmente.', cors);

  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > 4096) return err(413, 'too_large', 'Mensagem grande demais.', cors);
  let body: any;
  try { body = await req.json(); } catch { return err(400, 'invalid_input', 'Requisição inválida.', cors); }
  const text = typeof body?.text === 'string' ? body.text : '';
  const today = body?.today;
  if (text.trim().length < 1 || text.length > MAX_TEXT * 2) return err(400, 'invalid_input', `Escreva de 1 a ${MAX_TEXT} caracteres.`, cors);
  const nowIso = (d.now?.() ?? new Date()).toISOString().slice(0, 10);
  if (!isISODate(today) || today < addDays(nowIso, -2) || today > addDays(nowIso, 2)) return err(400, 'invalid_input', 'Data inválida.', cors);

  const quota = await d.takeQuota(jwt).catch(() => null);
  if (!quota) return err(503, 'unavailable', 'Serviço indisponível. Tente novamente.', cors);
  if (!quota.allowed) return err(429, 'rate_limited', 'Muitas mensagens em pouco tempo. Aguarde um instante.', cors, { 'retry-after': String(quota.retry_after ?? 30) });

  const categories = await d.loadCategories(jwt).catch(() => null);
  if (!categories || categories.length === 0) return err(503, 'unavailable', 'Serviço indisponível. Tente novamente.', cors);

  const provider = cfg.mode !== 'ai' ? cfg.provider!
    : cfg.name === 'gemini'
      ? geminiProvider({ apiKey: d.env('GEMINI_API_KEY')!, model: d.env('GEMINI_MODEL') ?? 'gemini-3.1-flash-lite', fetchImpl: d.fetchImpl })
      : anthropicProvider({ apiKey: d.env('ANTHROPIC_API_KEY')!, model: d.env('ANTHROPIC_MODEL') ?? 'claude-haiku-4-5', fetchImpl: d.fetchImpl });
  try {
    const out = await interpretMessage(text, { today, categories }, { provider, mode: cfg.mode as Mode, timeoutMs: Number(d.env('AI_TIMEOUT_MS') ?? 8000) });
    return json(200, out, cors); // o texto do usuário NÃO é registrado em log aqui
  } catch (e) {
    const code = e instanceof AiError ? e.code : 'provider_unavailable';
    if (code === 'invalid_input') return err(400, code, `Escreva de 1 a ${MAX_TEXT} caracteres.`, cors);
    if (code === 'provider_rate_limited') return err(429, code, 'O assistente está muito requisitado. Tente em instantes.', cors, { 'retry-after': '20' });
    if (code === 'timeout') return err(504, code, 'O assistente demorou demais. Tente de novo ou registre manualmente.', cors);
    if (code === 'invalid_model_output') return err(502, code, 'Não consegui interpretar essa frase. Tente reescrever ou registre manualmente.', cors);
    return err(502, 'provider_unavailable', 'O assistente está indisponível. Você ainda pode registrar manualmente.', cors);
  }
}
