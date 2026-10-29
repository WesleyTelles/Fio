import { useState } from 'preact/hooks';
import { Icon, Mark } from '../components/Icon';
import { Balance, mask } from '../components/Balance';
import { BalanceChart } from '../components/BalanceChart';
import { Empty, ErrorBox, SyncBadge, Skeleton, iconFor } from '../components/ui';
import { TxRow } from '../components/TxRow';
import { assistantSeed } from './Assistant';
import { needRefresh, applyUpdate, canUpdateNow } from '../lib/pwa';
import { auth } from '../lib/auth';
import { budgetV, catById, catName, fromCache, hideBalance, loadError, loading, navigate, profile, recentV, refreshAll, seriesV, session, setHide, sheet, snap, sumMonthV, sumWeekV, todayS, toast } from '../lib/state';
import { fmtBRL } from '../../supabase/functions/_shared/money';
import { addDays, groupLabel } from '../../supabase/functions/_shared/dates';
import { goalStats } from '../domain/goals';
import { pct } from '../domain/summary';

const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };

export function Home() {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [text, setText] = useState('');
  const hid = hideBalance.value, s = sumMonthV.value, w = sumWeekV.value;
  const name = profile.value?.display_name ?? session.value.name ?? '';
  const sum = period === 'week' ? w : s;
  const exp = sum ? sum.by_category.filter((c) => c.type === 'expense') : [];
  const total = sum?.outflow ?? 0;
  const alerts = (budgetV.value?.categories ?? []).filter((c) => c.limit && c.spent / c.limit >= 0.8).length;
  const nearestGoal = snap.value.goals.map((g) => ({ g, st: goalStats(g, todayS.value) })).filter((x) => x.st.status !== 'done').sort((a, b) => a.g.deadline.localeCompare(b.g.deadline))[0];
  const empty = !!s && s.count === 0 && snap.value.recent.length === 0 && recentV.value.length === 0;
  const submit = (e: Event) => { e.preventDefault(); if (!text.trim()) return; assistantSeed.value = text.trim(); setText(''); navigate('/assistente'); };
  const savedAt = snap.value.savedAt ? new Date(snap.value.savedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <main class="screen">
      <header style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <button class="press" onClick={() => navigate('/perfil')} aria-label="Abrir perfil" style="display:flex;align-items:center;gap:12px;min-height:48px">
          <span style="width:44px;height:44px;border-radius:50%;background:var(--s2);border:1px solid var(--s3);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;color:var(--lime)">{(name || '?').charAt(0).toUpperCase()}</span>
          <span style="display:flex;flex-direction:column"><span class="muted" style="font-size:13px">{greeting()}</span><span style="font-size:17px;font-weight:600;line-height:1.2">{name || ' '}</span></span>
        </button>
        <SyncBadge />
      </header>

      {needRefresh.value && <div class="banner" style="margin-top:14px" role="status"><Icon n="refresh" size={18} color="var(--lime)" /><div style="flex:1"><div style="color:#fff">Nova versão disponível.</div>
        {canUpdateNow() ? <button class="btn-link press" onClick={() => void applyUpdate()}>Atualizar agora</button> : <span class="muted">Há lançamentos pendentes: atualize depois de sincronizar.</span>}</div></div>}
      {fromCache.value && (loadError.value && loadError.value !== 'offline'
        ? <div class="banner warn" style="margin-top:14px" role="alert"><Icon n="warn" size={18} color="var(--danger)" /><span style="flex:1">{loadError.value} Mostrando dados salvos às {savedAt}.</span><button class="btn-link press" onClick={() => void auth.signOut(false)}>Entrar de novo</button></div>
        : <div class="banner" style="margin-top:14px" role="status"><Icon n="cloudOff" size={18} /><span>Mostrando dados salvos às {savedAt}. Podem estar desatualizados.</span></div>)}
      {loadError.value && !snap.value.savedAt && <div style="margin-top:14px"><ErrorBox text={loadError.value === 'offline' ? 'Sem conexão e ainda sem dados salvos neste aparelho.' : loadError.value} onRetry={() => void refreshAll()} /></div>}

      <section aria-label="Saldo" style="margin-top:34px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span class="muted" style="letter-spacing:.1em;text-transform:uppercase;font-weight:500">Seu saldo</span>
          <button class="press ibtn" onClick={() => setHide(!hid)} aria-pressed={hid} aria-label={hid ? 'Mostrar saldo' : 'Ocultar saldo'} style="margin-right:-10px">
            {hid ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" /><path class="slash" d="M3 3l18 18" /></svg> : <span class="eyeOpen" style="display:flex"><Icon n="eye" /></span>}
          </button>
        </div>
        {loading.value && !s ? <div style="padding:14px 0"><Skeleton h={56} w="70%" r={12} /></div> : <Balance value={s?.balance ?? 0} hidden={hid} />}
        <div style="display:flex;align-items:center;gap:10px;margin-top:16px;flex-wrap:wrap">
          {s && <span class="tag"><Icon n="send" size={14} sw={2.4} />{hid ? '••••' : (s.inflow - s.outflow >= 0 ? '+' : '−') + fmtBRL(Math.abs(s.inflow - s.outflow))} no mês</span>}
          <span class="muted" style="flex:1;min-width:160px">Entradas menos saídas do mês atual{snap.value.recent.length === 0 && recentV.value.some((x) => x.pending) ? ' (inclui pendentes)' : ''}.</span>
        </div>
      </section>

      <BalanceChart series={seriesV.value} hidden={hid} todayS={todayS.value} loading={loading.value} />

      {empty && <div style="margin-top:20px" class="card"><Empty icon="wallet" title="Comece pelo primeiro lançamento" text="Diga ao assistente o que você gastou ou recebeu, ou registre manualmente. Se já tem dinheiro na conta, defina seu saldo inicial no Perfil."
        action={<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn-p press" style="width:auto" onClick={() => { sheet.value = { k: 'txform', mode: 'new' }; }}>Novo lançamento</button><button class="btn-s press" onClick={() => navigate('/perfil')}>Saldo inicial</button></div>} /></div>}

      <section aria-label="Resumo do mês" style="margin-top:30px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr))">
          <div style="padding:18px 0 14px"><div class="muted" style="display:flex;align-items:center;gap:6px"><Icon n="arrowDL" size={14} sw={2.2} color="var(--lime)" />Entradas do mês</div><div data-testid="inflow" style="margin-top:6px;font-size:22px;font-weight:700;letter-spacing:-.02em">{s ? mask(hid, fmtBRL(s.inflow)) : <Skeleton h={26} w={110} />}</div></div>
          <div style="padding:18px 0 14px 20px;border-left:1px solid var(--line)"><div class="muted" style="display:flex;align-items:center;gap:6px"><Icon n="arrowUR" size={14} sw={2.2} color="#fff" />Saídas do mês</div><div data-testid="outflow" style="margin-top:6px;font-size:22px;font-weight:700;letter-spacing:-.02em">{s ? mask(hid, fmtBRL(s.outflow)) : <Skeleton h={26} w={110} />}</div></div>
        </div>
        <div style="padding:2px 0 16px"><div class="bar" style="height:4px"><i style={{ width: s ? Math.min(100, pct(s.outflow, s.inflow)) + '%' : '0%' }} /></div>
          <div class="muted" style="margin-top:8px">{s && s.inflow > 0 ? `Você já gastou ${pct(s.outflow, s.inflow)}% do que entrou neste mês.` : 'Registre uma receita para ver quanto do que entrou já foi gasto.'}</div></div>
      </section>

      <section aria-label="Assistente" style="margin-top:26px">
        <form class="cmd" onSubmit={submit}>
          <input type="text" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} maxLength={280} placeholder="Conte o que aconteceu…" aria-label="Conte ao assistente o que aconteceu" autocomplete="off" style="width:100%;height:44px;background:transparent;border:0;outline:none;font-size:15px;color:#fff;padding:0" />
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:2px">
            <span class="muted" style="display:flex;align-items:center;gap:8px"><Mark />Diga em linguagem natural</span>
            <button type="submit" class="press" disabled={!text.trim()} aria-label="Enviar ao assistente" style={{ width: '44px', height: '44px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: text.trim() ? 'var(--lime)' : 'var(--s2)', color: text.trim() ? 'var(--black)' : 'var(--gray3)' }}><Icon n="send" size={20} sw={2.2} /></button>
          </div>
        </form>
        <button class="press" onClick={() => setText('Gastei 8 reais com coxinha')} style="margin-top:6px;min-height:44px;font-size:12px;color:var(--gray)">Ex.: <span style="color:#fff;text-decoration:underline;text-decoration-color:var(--lime-dim);text-underline-offset:3px">Gastei 8 reais com coxinha</span></button>
      </section>

      <section aria-label="Para onde foi" style="margin-top:26px">
        <div class="sec-h"><h2>Para onde foi</h2>
          <div class="seg" role="group" aria-label="Período"><button aria-pressed={period === 'week'} onClick={() => setPeriod('week')}>Semana</button><button aria-pressed={period === 'month'} onClick={() => setPeriod('month')}>Mês</button></div></div>
        <div style="margin-top:16px;display:flex;align-items:baseline;justify-content:space-between;gap:12px"><span style="font-size:28px;font-weight:700;letter-spacing:-.03em">{sum ? mask(hid, fmtBRL(total)) : <Skeleton h={30} w={140} />}</span><span class="muted">{period === 'week' ? 'últimos 7 dias' : 'mês atual'}</span></div>
        <div style="margin-top:14px;display:flex;height:18px;border-radius:6px;overflow:hidden;background:var(--s1)" role="img" aria-label={exp.length ? exp.map((c) => `${catName(c.category_id)} ${pct(c.amount, total)}%`).join(', ') : 'Sem gastos no período'}>
          {exp.map((c, i) => <div key={c.category_id} style={{ flex: `${c.amount} 1 0%`, minWidth: 0, background: catById(c.category_id)?.color ?? '#6F7166', marginLeft: i ? '2px' : 0, transition: 'flex-grow 420ms var(--ease)' }} />)}
        </div>
        {sum && exp.length === 0 && <p class="muted" style="margin-top:14px;font-size:13px">Sem gastos neste período.</p>}
        <div style="margin-top:8px">{exp.map((c) => (
          <div key={c.category_id} style="display:flex;align-items:center;gap:12px;min-height:44px;border-bottom:1px solid var(--s1)">
            <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: catById(c.category_id)?.color ?? '#6F7166', flex: 'none' }} />
            <span style="flex:1;font-size:14px;font-weight:500">{catName(c.category_id)}</span><span class="muted" style="width:40px;text-align:right">{pct(c.amount, total)}%</span>
            <span style="font-size:14px;font-weight:600;min-width:92px;text-align:right">{mask(hid, fmtBRL(c.amount))}</span></div>))}</div>
      </section>

      {nearestGoal && <section aria-label="Metas" style="margin-top:32px">
        <div class="sec-h"><h2>Metas</h2><button class="btn-link press" onClick={() => navigate('/metas')}>Ver metas<Icon n="chevR" size={16} sw={2.2} /></button></div>
        <button class="row press" onClick={() => { sheet.value = { k: 'goal', id: nearestGoal.g.id }; }} style="display:block;margin-top:4px;padding:16px 0;border-top:1px solid var(--s1)">
          <div style="display:flex;align-items:center;gap:14px"><span class="ico" style="color:var(--lime)"><Icon n={iconFor(nearestGoal.g.icon)} size={20} sw={1.7} /></span>
            <span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{nearestGoal.g.name}</span><span class="muted">{mask(hid, fmtBRL(nearestGoal.g.saved))} de {mask(hid, fmtBRL(nearestGoal.g.target_amount))}</span></span>
            <span style="font-size:22px;font-weight:700;letter-spacing:-.02em">{nearestGoal.st.pct}%</span></div>
          <div class="bar" style="margin-top:14px"><i style={{ width: nearestGoal.st.pct + '%' }} /></div>
        </button></section>}

      <section aria-label="Atividade recente" style="margin-top:32px">
        <div class="sec-h"><h2>Atividade recente</h2><button class="btn-link press" onClick={() => navigate('/movimentacoes')}>Ver tudo<Icon n="chevR" size={16} sw={2.2} /></button></div>
        <div style="margin-top:4px" data-testid="recent">
          {loading.value && !s ? <><Skeleton h={56} /><div style="height:8px" /><Skeleton h={56} /></> : recentV.value.length === 0 ? <p class="muted" style="padding:18px 0">Nenhum lançamento ainda.</p> :
            recentV.value.map((t) => <TxRow key={t.id} tx={t} hidden={hid} when={groupLabel(t.occurred_on, todayS.value)} onOpen={() => { sheet.value = { k: 'txdetail', tx: t }; }} />)}
        </div>
      </section>
      <button class="btn-p press" style="margin-top:22px" onClick={() => { sheet.value = { k: 'txform', mode: 'new' }; }}><Icon n="plus" size={20} sw={2.2} />Novo lançamento manual</button>
    </main>
  );
}
