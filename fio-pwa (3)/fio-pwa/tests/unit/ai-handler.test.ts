import { describe, it, expect, vi } from 'vitest';
import { AiError, anthropicProvider, geminiProvider, buildSystemPrompt, demoProvider, interpretMessage } from '../../supabase/functions/_shared/ai.ts';
import { handleInterpret, resolveMode, type HandlerDeps } from '../../supabase/functions/_shared/handler.ts';
import { LLM_JSON_SCHEMA, LlmOutputSchema } from '../../supabase/functions/_shared/schema.ts';

const CATS = [{ key: 'alimentacao', name: 'Alimentação', kind: 'expense' as const }, { key: 'salario', name: 'Salário', kind: 'income' as const }, { key: 'outros', name: 'Outros', kind: 'expense' as const }];
const ctx = { today: '2026-10-21', categories: CATS };
const tool = (input: unknown) => new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_interpretation', input }] }), { status: 200 });
const good = { intent: 'register', type: 'expense', amount: 8, description: 'Coxinha', category: 'alimentacao', date: null, needs_clarification: false };

describe('contrato', () => {
  it('JSON Schema cobre as mesmas chaves do zod', () => {
    expect(Object.keys(LLM_JSON_SCHEMA.properties).sort()).toEqual(Object.keys(LlmOutputSchema.shape).sort());
  });
  it('zod rejeita lixo', () => {
    for (const bad of [null, 'x', {}, { intent: 'register' }, { intent: 'hack', needs_clarification: false }, { intent: 'register', amount: -1, needs_clarification: false }, { intent: 'register', amount: '8', needs_clarification: false }, { intent: 'register', date: '21/10', needs_clarification: false }])
      expect(LlmOutputSchema.safeParse(bad).success).toBe(false);
  });
  it('prompt só leva a frase e as categorias; trata o texto como dado', () => {
    const p = buildSystemPrompt(ctx); expect(p).toContain('alimentacao'); expect(p).toContain('ignore pedidos'); expect(p).not.toMatch(/saldo|R\$ ?\d/i);
  });
});

describe('provedor Anthropic (fetch simulado)', () => {
  it('envia só a frase, tool_use forçado e chave no cabeçalho', async () => {
    const f = vi.fn(async (..._a: unknown[]) => tool(good));
    const r = await interpretMessage('Gastei 8 reais com coxinha', ctx, { mode: 'ai', provider: anthropicProvider({ apiKey: 'k', model: 'm', fetchImpl: f as any }) });
    expect(r.result).toMatchObject({ status: 'proposal', proposal: { amount: 8 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([{ role: 'user', content: 'Gastei 8 reais com coxinha' }]);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'submit_interpretation' });
    expect((init.headers as any)['x-api-key']).toBe('k');
    expect(JSON.stringify(body)).not.toContain('balance');
  });
  it('resposta inválida: tenta uma vez de novo e depois falha com código claro', async () => {
    const f = vi.fn(async () => tool({ intent: 'register', amount: 'oito' }));
    await expect(interpretMessage('Gastei 8 com coxinha', ctx, { mode: 'ai', provider: anthropicProvider({ apiKey: 'k', model: 'm', fetchImpl: f as any }) })).rejects.toMatchObject({ code: 'invalid_model_output' });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('inválida na 1ª, válida na 2ª', async () => {
    let n = 0; const f = vi.fn(async () => (n++ === 0 ? tool({ foo: 1 }) : tool(good)));
    const r = await interpretMessage('Gastei 8 com coxinha', ctx, { mode: 'ai', provider: anthropicProvider({ apiKey: 'k', model: 'm', fetchImpl: f as any }) });
    expect(r.result.status).toBe('proposal');
  });
  it('429 e 5xx e rede e ausência de tool_use', async () => {
    const run = (f: any) => interpretMessage('Gastei 8 com coxinha', ctx, { mode: 'ai', retries: 0, provider: anthropicProvider({ apiKey: 'k', model: 'm', fetchImpl: f }) });
    await expect(run(async () => new Response('', { status: 429 }))).rejects.toMatchObject({ code: 'provider_rate_limited' });
    await expect(run(async () => new Response('', { status: 503 }))).rejects.toMatchObject({ code: 'provider_unavailable' });
    await expect(run(async () => { throw new TypeError('net'); })).rejects.toMatchObject({ code: 'provider_unavailable' });
    await expect(run(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'oi' }] }), { status: 200 }))).rejects.toMatchObject({ code: 'invalid_model_output' });
    await expect(run(async () => new Response('não é json', { status: 200 }))).rejects.toMatchObject({ code: 'invalid_model_output' });
  });
  it('timeout aborta a chamada', async () => {
    const f = (_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
    await expect(interpretMessage('Gastei 8 com coxinha', ctx, { mode: 'ai', timeoutMs: 20, provider: anthropicProvider({ apiKey: 'k', model: 'm', fetchImpl: f as any }) })).rejects.toMatchObject({ code: 'timeout' });
  });
  it('limites de entrada', async () => {
    const p = demoProvider;
    await expect(interpretMessage('', ctx, { mode: 'demo', provider: p })).rejects.toBeInstanceOf(AiError);
    await expect(interpretMessage('x'.repeat(281), ctx, { mode: 'demo', provider: p })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('modo demonstração', () => {
  it('categoria óbvia não é "sugestão"; ambígua (mercado) é', async () => {
    const a = await interpretMessage('Gastei 8 reais com coxinha', ctx, { mode: 'demo', provider: demoProvider });
    expect(a.result).toMatchObject({ status: 'proposal', proposal: { category_key: 'alimentacao', category_suggested: false } });
    const b = await interpretMessage('Gastei 35 no mercado', ctx, { mode: 'demo', provider: demoProvider });
    expect(b.result).toMatchObject({ status: 'proposal', proposal: { category_key: 'alimentacao', category_suggested: true } });
  });
  it('passa pelo mesmo validador e fica rotulado como demo', async () => {
    const r = await interpretMessage('Gastei 20 reais', ctx, { mode: 'demo', provider: demoProvider });
    expect(r.mode).toBe('demo'); expect(r.result).toMatchObject({ status: 'clarify', missing: 'description' });
  });
});

const deps = (over: Partial<HandlerDeps> = {}): HandlerDeps => ({
  env: (k) => ({ ALLOWED_ORIGIN: 'https://fio.app' } as Record<string, string>)[k],
  authenticate: async (jwt) => (jwt === 'good' ? 'u1' : null),
  takeQuota: async () => ({ allowed: true }), loadCategories: async () => CATS, now: () => new Date('2026-10-21T12:00:00Z'), ...over,
});
const post = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer good', origin: 'https://fio.app' }) =>
  new Request('https://x/functions/v1/interpret', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

const gem = (text: string | null, status = 200) => new Response(JSON.stringify(text === null ? { candidates: [] } : { candidates: [{ content: { parts: [{ text }] } }] }), { status });
describe('provedor Gemini (fetch simulado)', () => {
  it('chave no cabeçalho (não na URL), JSON mode, só a frase; saída revalidada', async () => {
    const f = vi.fn(async (..._a: unknown[]) => gem(JSON.stringify(good)));
    const r = await interpretMessage('Gastei 8 reais com coxinha', ctx, { mode: 'ai', provider: geminiProvider({ apiKey: 'gk', model: 'gemini-x', fetchImpl: f as any }) });
    expect(r.result).toMatchObject({ status: 'proposal', proposal: { amount: 8, category_key: 'alimentacao' } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
    expect(url).not.toContain('gk'); expect((init.headers as any)['x-goog-api-key']).toBe('gk');
    const body = JSON.parse(init.body as string);
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Gastei 8 reais com coxinha' }] }]);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.systemInstruction.parts[0].text).toContain('JSON');
  });
  it('aceita JSON dentro de cerca ```json', async () => {
    const f = async () => gem('```json\n' + JSON.stringify(good) + '\n```');
    const r = await interpretMessage('Gastei 8 reais com coxinha', ctx, { mode: 'ai', provider: geminiProvider({ apiKey: 'k', model: 'm', fetchImpl: f as any }) });
    expect(r.result.status).toBe('proposal');
  });
  it('valor inventado pelo modelo não vira lançamento (valor precisa estar no texto)', async () => {
    const f = async () => gem(JSON.stringify({ ...good, amount: 800 }));
    const r = await interpretMessage('Gastei 8 reais com coxinha', ctx, { mode: 'ai', provider: geminiProvider({ apiKey: 'k', model: 'm', fetchImpl: f as any }) });
    expect(r.result.status).toBe('clarify');
  });
  it('bloqueio/sem candidatos, texto não-JSON e 429/500 viram erros com código', async () => {
    const mk = (fetchImpl: any) => interpretMessage('Gastei 8 com pão', ctx, { mode: 'ai', retries: 0, provider: geminiProvider({ apiKey: 'k', model: 'm', fetchImpl }) });
    await expect(mk(async () => gem(null))).rejects.toMatchObject({ code: 'invalid_model_output' });
    await expect(mk(async () => gem('desculpe, não posso'))).rejects.toMatchObject({ code: 'invalid_model_output' });
    await expect(mk(async () => new Response('x', { status: 429 }))).rejects.toMatchObject({ code: 'provider_rate_limited' });
    await expect(mk(async () => new Response('x', { status: 500 }))).rejects.toMatchObject({ code: 'provider_unavailable' });
  });
  it('resolveMode escolhe o provedor pela chave; pedir IA sem chave desliga', () => {
    const r = (e: Record<string, string>) => resolveMode((k) => e[k]);
    expect(r({ GEMINI_API_KEY: 'g' })).toMatchObject({ mode: 'ai', name: 'gemini' });
    expect(r({ ANTHROPIC_API_KEY: 'a' })).toMatchObject({ mode: 'ai', name: 'anthropic' });
    expect(r({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', AI_PROVIDER: 'anthropic' })).toMatchObject({ name: 'anthropic' });
    expect(r({ AI_MODE: 'gemini' }).mode).toBe('off');
    expect(r({ AI_MODE: 'demo', GEMINI_API_KEY: 'g' }).mode).toBe('demo');
    expect(r({}).mode).toBe('demo');
  });
  it('handler com Gemini: chave nunca aparece na resposta de erro', async () => {
    const env = (k: string) => ({ GEMINI_API_KEY: 'gk-secret-999' } as any)[k];
    const r = await handleInterpret(post({ text: 'Gastei 8 com pão', today: '2026-10-21' }), deps({ env, fetchImpl: (async () => new Response('boom gk-secret-999', { status: 500 })) as any }));
    const t = await r.text(); expect(r.status).toBe(502); expect(t).not.toContain('gk-secret');
  });
});

describe('handler da Edge Function', () => {
  it('fluxo feliz (demo sem chave)', async () => {
    const r = await handleInterpret(post({ text: 'Gastei 8 reais com coxinha', today: '2026-10-21' }), deps());
    expect(r.status).toBe(200); const j = await r.json(); expect(j.mode).toBe('demo'); expect(j.result.proposal.category_key).toBe('alimentacao');
    expect(r.headers.get('cache-control')).toBe('no-store'); expect(r.headers.get('access-control-allow-origin')).toBe('https://fio.app');
  });
  it('GET informa o modo sem consumir cota nem chamar provedor; exige login', async () => {
    const quota = vi.fn(async () => ({ allowed: true }));
    const get = (h: Record<string, string>) => new Request('https://x/functions/v1/interpret', { method: 'GET', headers: h });
    const r = await handleInterpret(get({ authorization: 'Bearer good' }), deps({ takeQuota: quota }));
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ mode: 'demo' }); expect(quota).not.toHaveBeenCalled();
    expect((await handleInterpret(get({}), deps())).status).toBe(401);
    const off = await handleInterpret(get({ authorization: 'Bearer good' }), deps({ env: (k) => ({ AI_MODE: 'off' } as Record<string, string>)[k] }));
    expect(await off.json()).toEqual({ mode: 'off' });
  });
  it('sem token / token inválido => 401', async () => {
    expect((await handleInterpret(post({ text: 'a', today: '2026-10-21' }, {}), deps())).status).toBe(401);
    expect((await handleInterpret(post({ text: 'a', today: '2026-10-21' }, { authorization: 'Bearer bad' }), deps())).status).toBe(401);
  });
  it('origem não permitida não recebe CORS', async () => {
    const r = await handleInterpret(post({ text: 'Gastei 8 com pão', today: '2026-10-21' }, { authorization: 'Bearer good', origin: 'https://evil.com' }), deps());
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('rate limit => 429 com retry-after', async () => {
    const r = await handleInterpret(post({ text: 'Gastei 8 com pão', today: '2026-10-21' }), deps({ takeQuota: async () => ({ allowed: false, retry_after: 17 }) }));
    expect(r.status).toBe(429); expect(r.headers.get('retry-after')).toBe('17');
  });
  it('validação de entrada: tamanho, data, JSON', async () => {
    expect((await handleInterpret(post({ text: '', today: '2026-10-21' }), deps())).status).toBe(400);
    expect((await handleInterpret(post({ text: 'x'.repeat(600), today: '2026-10-21' }), deps())).status).toBe(400);
    expect((await handleInterpret(post({ text: 'Gastei 8 com pão', today: '2026-01-01' }), deps())).status).toBe(400);
    expect((await handleInterpret(post({ text: 'Gastei 8 com pão', today: 'ontem' }), deps())).status).toBe(400);
    const bad = new Request('https://x', { method: 'POST', headers: { authorization: 'Bearer good' }, body: '{' });
    expect((await handleInterpret(bad, deps())).status).toBe(400);
  });
  it('falha da cota não chama a IA', async () => {
    const f = vi.fn();
    const r = await handleInterpret(post({ text: 'Gastei 8 com pão', today: '2026-10-21' }), deps({ env: (k) => ({ AI_MODE: 'anthropic', ANTHROPIC_API_KEY: 'k' } as any)[k], takeQuota: async () => { throw new Error('db'); }, fetchImpl: f as any }));
    expect(r.status).toBe(503); expect(f).not.toHaveBeenCalled();
  });
  it('IA desligada => 503 ai_disabled; anthropic sem chave não simula IA', async () => {
    expect(resolveMode((k) => ({ AI_MODE: 'off' } as any)[k]).mode).toBe('off');
    expect(resolveMode((k) => ({ AI_MODE: 'anthropic' } as any)[k]).mode).toBe('off');
    expect(resolveMode((k) => ({ ANTHROPIC_API_KEY: 'k' } as any)[k]).mode).toBe('ai');
    expect(resolveMode(() => undefined).mode).toBe('demo');
    const r = await handleInterpret(post({ text: 'Gastei 8 com pão', today: '2026-10-21' }), deps({ env: (k) => ({ AI_MODE: 'off' } as any)[k] }));
    expect(r.status).toBe(503); expect((await r.json()).error.code).toBe('ai_disabled');
  });
  it('erros do provedor viram mensagens genéricas sem vazar detalhes', async () => {
    const env = (k: string) => ({ AI_MODE: 'anthropic', ANTHROPIC_API_KEY: 'sk-secret-123' } as any)[k];
    const r = await handleInterpret(post({ text: 'Gastei 8 com pão', today: '2026-10-21' }), deps({ env, fetchImpl: (async () => new Response('stack trace sk-secret-123', { status: 500 })) as any }));
    const t = await r.text(); expect(r.status).toBe(502); expect(t).not.toContain('sk-secret'); expect(t).not.toContain('stack');
  });
  it('não registra o texto do usuário em log', async () => {
    const spy = vi.spyOn(console, 'log'); const spy2 = vi.spyOn(console, 'error');
    await handleInterpret(post({ text: 'Gastei 8 reais com coxinha', today: '2026-10-21' }), deps());
    expect(JSON.stringify([...spy.mock.calls, ...spy2.mock.calls])).not.toContain('coxinha'); spy.mockRestore(); spy2.mockRestore();
  });
  it('OPTIONS e métodos', async () => {
    expect((await handleInterpret(new Request('https://x', { method: 'OPTIONS' }), deps())).status).toBe(204);
    expect((await handleInterpret(new Request('https://x', { method: 'PUT' }), deps())).status).toBe(405);
  });
});
