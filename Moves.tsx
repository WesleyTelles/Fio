import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../components/Icon';
import { Empty, ErrorBox, ListSkeleton } from '../components/ui';
import { TxRow } from '../components/TxRow';
import { api } from '../lib/api';
import { mapError } from '../lib/errors';
import { categories, hideBalance, myOps, pendingAsTx, sheet, snap, todayS } from '../lib/state';
import { applyPending } from '../domain/summary';
import { fmtBRL } from '../../supabase/functions/_shared/money';
import { addMonths, groupLabel, monthEnd, monthLabel, monthStart } from '../../supabase/functions/_shared/dates';
import type { Summary, Tx, TxType } from '../domain/types';

export function Moves() {
  const cur = monthStart(todayS.value);
  const [month, setMonth] = useState(cur);
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  const [type, setType] = useState<'all' | TxType>('all'); const [cat, setCat] = useState('all');
  const [items, setItems] = useState<Tx[]>([]); const [next, setNext] = useState<unknown>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading'); const [err, setErr] = useState(''); const [more, setMore] = useState(false);
  const [sum, setSum] = useState<Summary | null>(null);
  const seq = useRef(0); const hid = hideBalance.value;

  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);       // debounce da busca

  const load = async (append = false) => {
    const my = ++seq.current;                                                                                // descarta respostas obsoletas
    if (!append) setState('loading'); else setMore(true);
    try {
      const params = { from: month, to: monthEnd(month), category: cat === 'all' ? null : cat, type: type === 'all' ? null : type, q: dq || null, limit: 30, cursor: append ? next : null };
      const [page, s] = await Promise.all([api.list(params), append ? Promise.resolve(sum) : api.summary(month, monthEnd(month), todayS.value)]);
      if (my !== seq.current) return;
      setItems((prev) => (append ? [...prev, ...page.items] : page.items)); setNext(page.next); if (s) setSum(s); setState('ok'); setErr('');
    } catch (e) { if (my !== seq.current) return; setErr(mapError(e).message); setState('error'); }
    finally { if (my === seq.current) setMore(false); }
  };
  useEffect(() => { void load(false); }, [month, dq, type, cat, snap.value.savedAt]);               // recarrega quando o servidor muda (sincronização, edição…)

  const pend = useMemo(() => myOps.value.filter((o) => o.status !== 'rejected').map(pendingAsTx).filter((t) =>
    t.occurred_on >= month && t.occurred_on <= monthEnd(month) && (cat === 'all' || t.category_id === cat) && (type === 'all' || t.type === type) &&
    (!dq || (t.description + ' ' + (categories.value.find((c) => c.id === t.category_id)?.name ?? '')).toLowerCase().includes(dq.toLowerCase()))), [myOps.value, month, cat, type, dq]);
  const all = useMemo(() => [...pend, ...items].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at)), [pend, items]);
  const groups = useMemo(() => { const m = new Map<string, Tx[]>(); for (const t of all) { (m.get(t.occurred_on) ?? m.set(t.occurred_on, []).get(t.occurred_on)!).push(t); } return [...m.entries()]; }, [all]);
  const view = sum ? applyPending(sum, myOps.value) : null;
  const fmt = (n: number) => (hid ? '••••' : fmtBRL(n));
  const usedCats = categories.value.filter((c) => !c.archived_at || items.some((i) => i.category_id === c.id));
  const filtered = cat !== 'all' || type !== 'all' || !!dq;

  return (
    <main class="screen">
      <h1 class="h1">Movimentações</h1>
      <div style="display:flex;align-items:center;gap:4px;margin-top:6px">
        <button class="press ibtn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mês anterior" style="margin-left:-10px"><Icon n="back" size={20} sw={2} /></button>
        <span style="font-size:15px;font-weight:500;min-width:150px;text-align:center" aria-live="polite">{monthLabel(month)}</span>
        <button class="press ibtn" onClick={() => setMonth(addMonths(month, 1))} disabled={month >= cur} style={{ opacity: month >= cur ? 0.35 : 1 }} aria-label="Próximo mês"><Icon n="chevR" size={20} sw={2} /></button>
      </div>
      <div style="margin-top:14px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
        <div style="padding:14px 0"><div class="muted" style="font-size:11px">Entradas</div><div style="font-size:15px;font-weight:700;color:var(--lime);margin-top:2px">{view ? fmt(view.inflow) : '—'}</div></div>
        <div style="padding:14px 0 14px 14px;border-left:1px solid var(--line)"><div class="muted" style="font-size:11px">Saídas</div><div style="font-size:15px;font-weight:700;margin-top:2px">{view ? fmt(view.outflow) : '—'}</div></div>
        <div style="padding:14px 0 14px 14px;border-left:1px solid var(--line)"><div class="muted" style="font-size:11px">Resultado</div><div style="font-size:15px;font-weight:700;margin-top:2px">{view ? fmt(view.inflow - view.outflow) : '—'}</div></div>
      </div>
      <label for="mv-q" class="sr">Buscar movimentações</label>
      <div class="cmd" style="margin-top:16px;display:flex;align-items:center;gap:10px;height:48px;padding:0 14px;border-radius:16px;border-color:var(--line)">
        <Icon n="search" size={18} sw={1.9} color="var(--gray)" />
        <input id="mv-q" type="search" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="Buscar por descrição ou categoria" autocomplete="off" maxLength={60} style="flex:1;min-width:0;height:44px;background:transparent;border:0;outline:none;color:#fff;font-size:14px;padding:0" />
      </div>
      <div role="group" aria-label="Tipo" style="margin-top:12px;display:flex;gap:8px">
        {([['all', 'Todos'], ['income', 'Entradas'], ['expense', 'Saídas']] as const).map(([k, l]) => <button key={k} class="chip press" aria-pressed={type === k} onClick={() => setType(k)}><span>{l}</span></button>)}
      </div>
      <div role="group" aria-label="Categoria" style="margin:0 -24px;padding:0 24px;display:flex;gap:8px;overflow-x:auto">
        <button class="chip press" aria-pressed={cat === 'all'} onClick={() => setCat('all')}><span>Todas</span></button>
        {usedCats.map((c) => <button key={c.id} class="chip press" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}><span>{c.name}</span></button>)}
      </div>

      <div style="margin-top:8px" data-testid="moves-list">
        {state === 'loading' && all.length === 0 ? <ListSkeleton /> : state === 'error' ? <ErrorBox text={err} onRetry={() => void load(false)} /> :
          groups.length === 0 ? <Empty icon="search" title={filtered ? 'Nada encontrado' : 'Sem lançamentos neste mês'} text={filtered ? 'Tente outros filtros ou outra busca.' : 'Registre uma despesa ou receita para vê-la aqui.'}
            action={!filtered && <button class="btn-p press" style="width:auto" onClick={() => { sheet.value = { k: 'txform', mode: 'new' }; }}>Novo lançamento</button>} /> :
          groups.map(([d, list]) => (
            <section key={d} aria-label={groupLabel(d, todayS.value)}>
              <h2 class="muted" style="font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin:16px 0 2px">{groupLabel(d, todayS.value)}</h2>
              {list.map((t) => <TxRow key={t.id} tx={t} hidden={hid} when={t.pending ? 'aguardando envio' : new Date(t.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} onOpen={() => { sheet.value = { k: 'txdetail', tx: t }; }} />)}
            </section>))}
        {next != null && state === 'ok' && <button class="btn-s press" style="width:100%;margin-top:16px" disabled={more} onClick={() => void load(true)}>{more ? 'Carregando…' : 'Carregar mais'}</button>}
      </div>
      <button class="btn-p press" style="margin-top:20px" onClick={() => { sheet.value = { k: 'txform', mode: 'new' }; }}><Icon n="plus" size={20} sw={2.2} />Novo lançamento</button>
    </main>
  );
}
