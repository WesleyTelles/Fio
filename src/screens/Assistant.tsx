import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Icon, Mark } from '../components/Icon';
import { api } from '../lib/api';
import { AppError, mapError } from '../lib/errors';
import { aiKeyToId, budgetV, catById, catName, categories, createTransaction, expenseCats, incomeCats, navigate, online, session, sheet, snap, sumMonthV, sumWeekV, todayS } from '../lib/state';
import { fmtBRL } from '../../supabase/functions/_shared/money';
import { longDate, shortDate } from '../../supabase/functions/_shared/dates';
import { goalStats } from '../domain/goals';
import { pct } from '../domain/summary';
import type { InterpretResult, Missing, Proposal, Topic } from '../../supabase/functions/_shared/schema';
import type { TxType } from '../domain/types';

export const assistantSeed = signal<string | null>(null);
type Draft = { type: TxType; amount: number; description: string; category_id: string | ''; date: string; suggested: boolean; key: string; status: 'open' | 'busy' | 'done' | 'cancelled'; error?: string; outcome?: 'synced' | 'pending' };
type Act = { label: string; to: string };
type Msg =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'ai'; kind: 'proc' }
  | { id: string; role: 'ai'; kind: 'text'; text: string; actions?: Act[]; manual?: boolean; pick?: { type: TxType } }
  | { id: string; role: 'ai'; kind: 'draft'; draft: Draft };
const chat = signal<Msg[]>([]);
const aiMode = signal<'unknown' | 'demo' | 'ai' | 'disabled'>('unknown');
let pendingClarify: { missing: Missing; partial: { type?: TxType; amount?: number; description?: string; date?: string } } | null = null;
const uid = () => crypto.randomUUID();
const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : null;

export function resetAssistant() { chat.value = []; aiMode.value = 'unknown'; pendingClarify = null; }
// a conversa vive só na memória e some ao sair da conta (minimização de dados)
if (typeof window !== 'undefined') { let last = session.value.status; session.subscribe((s) => { if (s.status !== last && s.status !== 'in') resetAssistant(); last = s.status; }); }

function answer(topic: Topic): Msg {
  const m = (text: string, actions?: Act[]): Msg => ({ id: uid(), role: 'ai', kind: 'text', text, actions });
  const w = sumWeekV.value, s = sumMonthV.value;
  const top = (sum: typeof w) => { const e = sum?.by_category.filter((c) => c.type === 'expense')[0]; return e && sum && sum.outflow > 0 ? `, principalmente em ${catName(e.category_id)} (${pct(e.amount, sum.outflow)}%)` : ''; };
  if (!w || !s) return m('Ainda não carreguei seus dados. Tente de novo em instantes.');
  if (topic === 'week') return m(w.outflow > 0 ? `Nos últimos 7 dias você gastou ${fmtBRL(w.outflow)}${top(w)}.` : 'Não há gastos registrados nos últimos 7 dias.', [{ label: 'Ver movimentações', to: '/movimentacoes' }]);
  if (topic === 'month' || topic === 'general') return m(`Neste mês entraram ${fmtBRL(s.inflow)} e saíram ${fmtBRL(s.outflow)}${top(s)}. Saldo atual: ${fmtBRL(s.balance)}.`, [{ label: 'Ver insights', to: '/insights' }]);
  if (topic === 'budget') {
    const b = budgetV.value; if (!b || b.total_limit == null) return m('Você ainda não definiu um orçamento do mês. Defina um limite para eu acompanhar.', [{ label: 'Definir orçamento', to: '/orcamento' }]);
    const near = b.categories.filter((c) => c.limit && c.spent / c.limit >= 0.8).map((c) => `${catName(c.category_id)} (${pct(c.spent, c.limit!)}%)`);
    return m(`Do orçamento de ${fmtBRL(b.total_limit)}, você usou ${fmtBRL(b.total_spent)}; ${b.total_limit - b.total_spent >= 0 ? `restam ${fmtBRL(b.total_limit - b.total_spent)}` : `passou ${fmtBRL(b.total_spent - b.total_limit)}`}.${near.length ? ` Atenção em: ${near.join(', ')}.` : ''}`, [{ label: 'Ver orçamento', to: '/orcamento' }]);
  }
  if (topic === 'goals') {
    const g = snap.value.goals; if (!g.length) return m('Você ainda não tem metas. Crie uma e eu calculo quanto guardar por mês.', [{ label: 'Criar meta', to: '/metas' }]);
    return m(g.map((x) => { const st = goalStats(x, todayS.value); return `• ${x.name}: ${st.pct}% (${fmtBRL(x.saved)} de ${fmtBRL(x.target_amount)})${st.remaining > 0 && st.daysLeft >= 0 ? ` — guardar ${fmtBRL(st.needPerMonth)}/mês até ${shortDate(x.deadline)}` : ''}`; }).join('\n'), [{ label: 'Ver metas', to: '/metas' }]);
  }
  return m('Para planejar, crie uma meta com valor e prazo: eu calculo quanto guardar por mês (conta simples: o que falta ÷ meses restantes).', [{ label: 'Criar meta', to: '/metas' }]);
}

function toDraft(p: { type: TxType; amount: number; description: string; category_id?: string; date: string; suggested: boolean }): Draft {
  return { type: p.type, amount: p.amount, description: p.description, category_id: p.category_id ?? '', date: p.date, suggested: p.suggested, key: uid(), status: 'open' };
}
const proposalDraft = (p: Proposal) => toDraft({ type: p.type, amount: p.amount, description: p.description, category_id: aiKeyToId(p.category_key), date: p.date, suggested: p.category_suggested });

export function Assistant() {
  const [input, setInput] = useState(''); const [busy, setBusy] = useState(false); const [listening, setListening] = useState(false);
  const endRef = useRef<HTMLDivElement>(null); const recRef = useRef<any>(null);
  const mode = aiMode.value;
  const push = (...m: Msg[]) => { chat.value = [...chat.value, ...m]; };
  const replaceProc = (m: Msg) => { chat.value = chat.value.filter((x) => !(x.role === 'ai' && 'kind' in x && x.kind === 'proc')).concat(m); };
  const patchDraft = (id: string, p: Partial<Draft>) => { chat.value = chat.value.map((x) => (x.id === id && x.role === 'ai' && x.kind === 'draft' ? { ...x, draft: { ...x.draft, ...p } } : x)); };
  useEffect(() => { if (aiMode.value === 'unknown' && online.value) api.aiMode().then((m) => { aiMode.value = m === 'off' ? 'disabled' : m; }).catch(() => { /* rótulo aparece após a 1ª resposta */ }); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [chat.value.length]);

  const handle = (r: InterpretResult) => {
    if (r.status === 'proposal') { pendingClarify = null; return replaceProc({ id: uid(), role: 'ai', kind: 'draft', draft: proposalDraft(r.proposal) }); }
    if (r.status === 'clarify') {
      pendingClarify = { missing: r.missing, partial: r.partial };
      return replaceProc({ id: uid(), role: 'ai', kind: 'text', text: r.question, pick: r.missing === 'category' && r.partial.type ? { type: r.partial.type } : undefined, manual: r.missing === 'type' });
    }
    pendingClarify = null;
    if (r.status === 'question') return replaceProc(answer(r.topic));
    return replaceProc({ id: uid(), role: 'ai', kind: 'text', text: 'Não entendi. Tente algo como “Gastei 8 reais com coxinha” ou “Recebi 250 de um freela”. Para perguntas: “Quanto gastei esta semana?”.' });
  };

  const rebuild = (text: string) => {
    const pc = pendingClarify; if (!pc || /\d/.test(text) && pc.missing === 'description') return text;
    const { type, amount, description, date } = pc.partial; const verb = type === 'income' ? 'Recebi' : 'Gastei', prep = type === 'income' ? 'de' : 'com';
    const a = amount != null ? String(amount).replace('.', ',') : '', dd = date && date !== todayS.value ? ` dia ${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '';
    if (pc.missing === 'description') return `${verb} ${a} ${prep} ${text}${dd}`;
    if (pc.missing === 'amount') return `${verb} ${text} ${prep} ${description ?? ''}${dd}`;
    if (pc.missing === 'date') return `${verb} ${a} ${prep} ${description ?? ''} ${text}`;
    return text;
  };

  const send = async (raw: string) => {
    const text = raw.trim(); if (!text || busy || mode === 'disabled') return;
    setInput(''); setBusy(true);
    const toSend = rebuild(text);
    push({ id: uid(), role: 'user', text }, { id: uid(), role: 'ai', kind: 'proc' });
    try {
      if (!online.value) throw new AppError('network', 'network', 'offline');
      const res = await api.interpret(toSend, todayS.value);
      aiMode.value = res.mode; handle(res.result);
    } catch (e) {
      const err = mapError(e);
      if (err.kind === 'disabled') { aiMode.value = 'disabled'; replaceProc({ id: uid(), role: 'ai', kind: 'text', text: 'O assistente de IA está desativado no momento. Você pode registrar manualmente — tudo continua funcionando.', manual: true }); }
      else if (err.kind === 'network') replaceProc({ id: uid(), role: 'ai', kind: 'text', text: 'O assistente precisa de internet. Registre manualmente: sem conexão, o lançamento fica guardado aqui como pendente até sincronizar.', manual: true });
      else if (err.kind === 'auth') replaceProc({ id: uid(), role: 'ai', kind: 'text', text: 'Sua sessão expirou. Entre novamente para continuar.' });
      else replaceProc({ id: uid(), role: 'ai', kind: 'text', text: err.message || 'O assistente não conseguiu responder agora. Tente de novo ou registre manualmente.', manual: true });
    } finally { setBusy(false); }
  };

  useEffect(() => { const s = assistantSeed.value; if (s) { assistantSeed.value = null; void send(s); } }, []);

  const confirm = async (m: Extract<Msg, { kind: 'draft' }>) => {
    const d = m.draft; if (d.status !== 'open') return;
    if (!d.category_id) return patchDraft(m.id, { error: 'Escolha uma categoria antes de confirmar.' });
    patchDraft(m.id, { status: 'busy', error: undefined });
    const r = await createTransaction({ type: d.type, amount: d.amount, description: d.description, category_id: d.category_id, occurred_on: d.date, source: 'ai', ai_meta: { mode: aiMode.value === 'ai' ? 'ai' : 'demo' } }, d.key);
    if (r.rejected) return patchDraft(m.id, { status: 'open', error: r.rejected.message });  // mantém a proposta para tentar de novo
    patchDraft(m.id, { status: 'done', outcome: r.synced ? 'synced' : 'pending', error: undefined });
  };
  const edit = (m: Extract<Msg, { kind: 'draft' }>) => { const d = m.draft; sheet.value = { k: 'txform', mode: 'draft', source: 'ai', aiMeta: { mode: aiMode.value === 'ai' ? 'ai' : 'demo' }, init: { type: d.type, amount: String(d.amount).replace('.', ','), description: d.description, category_id: d.category_id || undefined, date: d.date }, onDone: () => patchDraft(m.id, { status: 'done', outcome: 'synced' }) }; };
  const pick = (type: TxType, id: string) => {
    const pc = pendingClarify; if (!pc) return; pendingClarify = null;
    push({ id: uid(), role: 'user', text: catName(id) });
    push({ id: uid(), role: 'ai', kind: 'draft', draft: toDraft({ type, amount: pc.partial.amount ?? 0, description: pc.partial.description ?? '', category_id: id, date: pc.partial.date ?? todayS.value, suggested: false }) });
  };
  const mic = () => {
    if (!SR) return;
    if (listening) { recRef.current?.stop(); return; }
    const r = new SR(); r.lang = 'pt-BR'; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e: any) => setInput(String(e.results[0][0].transcript ?? '')); r.onend = () => setListening(false); r.onerror = () => setListening(false);
    recRef.current = r; setListening(true); try { r.start(); } catch { setListening(false); }
  };

  return (
    <main class="screen nonav" style="display:flex;flex-direction:column;padding-bottom:0;height:100dvh">
      <header style="display:flex;align-items:center;gap:8px;padding-bottom:10px">
        <button class="press ibtn" onClick={() => navigate('/')} aria-label="Voltar" style="margin-left:-10px"><Icon n="back" size={22} sw={2} /></button>
        <Mark size={22} run={busy} /><h1 style="font-size:18px;font-weight:600;flex:1">Assistente</h1>
        {mode !== 'unknown' && <span class={`tag ${mode === 'ai' ? '' : 'neutral'}`} data-testid="ai-mode">{mode === 'ai' ? 'IA' : mode === 'demo' ? 'Modo demonstração' : 'Desativado'}</span>}
      </header>
      {mode === 'demo' && <div class="banner" style="margin-bottom:8px" role="note"><Icon n="info" size={18} /><span>Modo demonstração: a interpretação usa regras locais, não inteligência artificial. Você sempre confirma antes de registrar.</span></div>}
      {mode === 'disabled' && <div class="banner warn" style="margin-bottom:8px" role="note"><Icon n="warn" size={18} color="var(--danger)" /><span>Assistente desativado. O registro manual continua funcionando.</span></div>}
      <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:12px;padding:6px 0 12px" role="log" aria-live="polite" aria-label="Conversa">
        {chat.value.length === 0 && <div style="margin:auto 0;text-align:center;padding:20px 8px"><Mark size={40} /><h2 style="font-size:20px;font-weight:600;margin:14px 0 6px">O que aconteceu?</h2><p class="muted" style="font-size:13px">Escreva do seu jeito. Eu monto o lançamento e você confirma antes de salvar.</p>
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:16px;align-items:center">{['Gastei 8 reais com coxinha', 'Recebi 250 reais de um freela', 'Gastei 20 reais', 'Quanto gastei esta semana?'].map((x) => <button key={x} class="chip press" onClick={() => void send(x)} disabled={busy || mode === 'disabled'}><span>{x}</span></button>)}</div></div>}
        {chat.value.map((m) => m.role === 'user' ? <div class="msg user" key={m.id}>{m.text}</div> :
          m.kind === 'proc' ? <div class="msg ai" key={m.id} style="display:flex;align-items:center;gap:10px;color:var(--gray)"><Mark run /> Entendendo sua mensagem…</div> :
          m.kind === 'text' ? <div class="msg ai" key={m.id}><div style="white-space:pre-line">{m.text}</div>
            {m.pick && <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">{(m.pick.type === 'expense' ? expenseCats.value : incomeCats.value).map((c) => <button key={c.id} class="chip press" onClick={() => pick(m.pick!.type, c.id)}><span>{c.name}</span></button>)}</div>}
            {(m.actions || m.manual) && <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">{m.actions?.map((a) => <button key={a.to} class="btn-link press" onClick={() => navigate(a.to)}>{a.label}<Icon n="chevR" size={16} sw={2.2} /></button>)}{m.manual && <button class="btn-link press" onClick={() => { sheet.value = { k: 'txform', mode: 'new' }; }}>Registrar manualmente</button>}</div>}</div> :
          <DraftCard key={m.id} m={m} onConfirm={() => void confirm(m)} onEdit={() => edit(m)} onCancel={() => patchDraft(m.id, { status: 'cancelled' })} onCat={(id) => patchDraft(m.id, { category_id: id, suggested: false, error: undefined })} />)}
        <div ref={endRef} />
      </div>
      <form class="cmd" onSubmit={(e) => { e.preventDefault(); void send(input); }} style="margin-bottom:calc(16px + var(--safe-b))">
        <label for="as-in" class="sr">Mensagem para o assistente</label>
        <input id="as-in" type="text" value={input} maxLength={280} disabled={busy || mode === 'disabled'} onInput={(e) => setInput((e.target as HTMLInputElement).value)} placeholder={mode === 'disabled' ? 'Assistente desativado' : 'Ex.: Gastei 35 no mercado ontem'} autocomplete="off" style="width:100%;height:44px;background:transparent;border:0;outline:none;font-size:16px;color:#fff;padding:0" />
        <div style="display:flex;align-items:center;justify-content:space-between"><button type="button" class="btn-link press" onClick={() => { sheet.value = { k: 'txform', mode: 'new' }; }}>Registrar manualmente</button>
          <span style="display:flex;gap:2px">{SR && <button type="button" class="press ibtn" onClick={mic} aria-label="Falar" aria-pressed={listening} style={{ color: listening ? 'var(--lime)' : undefined }}><Icon n="mic" /></button>}
            <button type="submit" class="press" disabled={!input.trim() || busy || mode === 'disabled'} aria-label="Enviar" style={{ width: '44px', height: '44px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: input.trim() && !busy ? 'var(--lime)' : 'var(--s2)', color: input.trim() && !busy ? 'var(--black)' : 'var(--gray3)' }}><Icon n="send" size={20} sw={2.2} /></button></span></div>
      </form>
    </main>
  );
}

function DraftCard({ m, onConfirm, onEdit, onCancel, onCat }: { m: Extract<Msg, { kind: 'draft' }>; onConfirm: () => void; onEdit: () => void; onCancel: () => void; onCat: (id: string) => void }) {
  const d = m.draft; const list = d.type === 'expense' ? expenseCats.value : incomeCats.value;
  if (d.status === 'cancelled') return <div class="msg ai muted" style="font-size:13px">Cancelado. Nada foi registrado.</div>;
  if (d.status === 'done') return (
    <div class="msg ai" data-testid="draft-done"><div style="display:flex;align-items:center;gap:8px;font-weight:600"><Icon n="check" size={18} color="var(--lime)" sw={2.4} />{d.outcome === 'pending' ? 'Guardado neste aparelho' : 'Registrado'}</div>
      <p class="muted" style="margin-top:4px;font-size:13px">{d.outcome === 'pending' ? 'Ainda não foi confirmado pelo servidor: aparece como pendente e sincroniza quando houver conexão.' : `${d.type === 'income' ? '+' : '−'}${fmtBRL(d.amount)} · ${d.description}. Saldo e orçamento já foram atualizados.`}</p>
      <button class="btn-link press" onClick={() => navigate('/')}>Ver no início<Icon n="chevR" size={16} sw={2.2} /></button></div>);
  return (
    <div class="msg ai card" style="width:100%;max-width:100%" data-testid="draft" aria-label="Proposta de lançamento">
      <div class="muted" style="letter-spacing:.06em;text-transform:uppercase;font-weight:600;margin-bottom:6px">Proposta — nada foi salvo ainda</div>
      <div style={{ fontSize: '32px', fontWeight: 700, letterSpacing: '-.03em', color: d.type === 'income' ? 'var(--lime)' : '#fff' }}>{d.type === 'income' ? '+' : '−'}{fmtBRL(d.amount)}</div>
      <dl style="margin:10px 0 12px;display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px">
        <dt class="muted">Tipo</dt><dd style="margin:0;text-align:right">{d.type === 'income' ? 'Receita' : 'Despesa'}</dd>
        <dt class="muted">Descrição</dt><dd style="margin:0;text-align:right">{d.description || '—'}</dd>
        <dt class="muted">Data</dt><dd style="margin:0;text-align:right">{longDate(d.date)}</dd>
        <dt class="muted"><label for={'cat-' + m.id}>Categoria</label></dt>
        <dd style="margin:0;text-align:right"><select id={'cat-' + m.id} class="input" style="height:40px;font-size:14px;padding:0 12px;width:auto;min-width:150px" value={d.category_id} onChange={(e) => onCat((e.target as HTMLSelectElement).value)} disabled={d.status === 'busy'}>
          <option value="">Escolha…</option>{list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          {d.suggested && d.category_id && <div class="muted" style="font-size:11px;margin-top:2px">Sugerida pelo assistente — confira</div>}</dd></dl>
      {d.error && <div class="err" role="alert" style="margin-bottom:8px">{d.error}</div>}
      <div style="display:flex;gap:8px"><button class="btn-p press" style="flex:2;min-height:48px" disabled={d.status === 'busy'} onClick={onConfirm}>{d.status === 'busy' ? 'Registrando…' : 'Confirmar'}</button>
        <button class="btn-s press" style="flex:1" disabled={d.status === 'busy'} onClick={onEdit}>Editar</button><button class="btn-s press" style="flex:1" disabled={d.status === 'busy'} onClick={onCancel}>Cancelar</button></div>
    </div>);
}
