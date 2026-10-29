import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../components/Icon';
import { Empty, ErrorBox, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { mapError } from '../lib/errors';
import { budgetV, categories, myOps, navigate, sheet, snap, todayS } from '../lib/state';
import { applyPending } from '../domain/summary';
import { computeInsights, type Insight } from '../domain/insights';
import { addDays, addMonths, daysInMonth, monthStart } from '../../supabase/functions/_shared/dates';
import type { Summary } from '../domain/types';

export function Insights() {
  const t = todayS.value;
  const [cur, setCur] = useState<Summary | null>(null); const [prev, setPrev] = useState<Summary | null>(null);
  const [err, setErr] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const load = async () => {
    setErr('');
    try {
      const ms = monthStart(t), pms = addMonths(ms, -1), day = Number(t.slice(8, 10));
      const pEnd = addDays(pms, Math.min(day, daysInMonth(pms)) - 1);
      const [c, p] = await Promise.all([api.summary(ms, t, t), api.summary(pms, pEnd, t)]);
      setCur(c); setPrev(p);
    } catch (e) { setErr(mapError(e).message); }
  };
  useEffect(() => { void load(); }, [t, snap.value.savedAt]);

  const list: Insight[] | null = cur && prev && budgetV.value
    ? computeInsights({ today: t, current: applyPending(cur, myOps.value), previous: prev, budget: budgetV.value, categories: categories.value, goals: snap.value.goals }) : null;
  const toneColor = { alert: 'var(--danger)', good: 'var(--lime)', info: 'var(--gray)' } as const;
  return (
    <main class="screen">
      <h1 class="h1">Insights</h1>
      <p class="muted" style="margin-top:4px;font-size:13px">Calculados dos seus lançamentos reais — cada um mostra como foi feito.</p>
      <div style="margin-top:16px">
        {err ? <ErrorBox text={err} onRetry={() => void load()} /> : !list ? <><Skeleton h={84} r={20} /><div style="height:12px" /><Skeleton h={84} r={20} /></> :
          list.length === 0 ? <Empty icon="insights" title="Ainda não há o que mostrar" text="Registre algumas despesas e defina um orçamento ou uma meta. Os insights aparecem a partir dos seus dados."
            action={<button class="btn-p press" style="width:auto" onClick={() => { sheet.value = { k: 'txform', mode: 'new' }; }}>Novo lançamento</button>} /> :
          list.map((i) => (
            <article class="card" key={i.id} style="margin-bottom:12px">
              <div style="display:flex;gap:12px;align-items:flex-start">
                <span style={{ width: '4px', alignSelf: 'stretch', borderRadius: '2px', background: toneColor[i.tone], flex: 'none' }} aria-hidden="true" />
                <div style="flex:1"><div style="font-size:12px;font-weight:600;color:var(--gray);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px">{i.tone === 'alert' ? 'Atenção' : i.tone === 'good' ? 'Bom sinal' : 'Observação'}</div>
                  <h2 style="font-size:16px;font-weight:600;line-height:1.35">{i.title}</h2><p class="muted" style="margin-top:6px;font-size:13px">{i.body}</p>
                  <button class="btn-link press" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>Como calculamos</button>
                  {open === i.id && <p class="muted" style="margin-top:2px">{i.basis}</p>}</div></div>
            </article>))}
      </div>
      <button class="btn-s press" style="margin-top:6px;width:100%" onClick={() => navigate('/orcamento')}><Icon n="wallet" size={18} />Ajustar orçamento</button>
    </main>
  );
}
