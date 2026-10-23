import { useState } from 'preact/hooks';
import { Icon } from '../components/Icon';
import { Empty, iconFor } from '../components/ui';
import { budgetV, catById, catName, expenseCats, hideBalance, navigate, route, sheet, snap, todayS } from '../lib/state';
import { mask } from '../components/Balance';
import { fmtBRL } from '../../supabase/functions/_shared/money';
import { daysInMonth, monthLabel, shortDate } from '../../supabase/functions/_shared/dates';
import { goalStats, STATUS_LABEL } from '../domain/goals';
import { pct } from '../domain/summary';

export function Budget() {
  const tab = route.value === '/metas' ? 'goals' : 'budget';
  return (
    <main class="screen">
      <h1 class="h1">{tab === 'budget' ? 'Orçamento' : 'Metas'}</h1>
      <p class="muted" style="margin-top:4px;font-size:13px">{tab === 'budget' ? monthLabel(todayS.value) : 'O que você quer conquistar e quanto já guardou.'}</p>
      <div class="seg" role="group" aria-label="Seção" style="margin-top:16px">
        <button aria-pressed={tab === 'budget'} onClick={() => navigate('/orcamento')}>Orçamento</button>
        <button aria-pressed={tab === 'goals'} onClick={() => navigate('/metas')}>Metas</button>
      </div>
      {tab === 'budget' ? <BudgetTab /> : <GoalsTab />}
    </main>
  );
}

function BudgetTab() {
  const b = budgetV.value, hid = hideBalance.value, t = todayS.value;
  const day = Number(t.slice(8, 10)), dim = daysInMonth(t), left = dim - day;
  if (!b) return <div style="padding:30px 0" class="muted">Carregando…</div>;
  const total = b.total_limit;
  const limited = b.categories.filter((c) => c.limit != null);
  const unlimited = b.categories.filter((c) => c.limit == null && c.spent > 0);
  const free = expenseCats.value.filter((c) => !b.categories.some((r) => r.category_id === c.id));
  const avail = total != null ? total - b.total_spent : null;
  return (
    <div>
      <section class="card" style="margin-top:18px" aria-label="Orçamento do mês">
        <div class="muted" style="letter-spacing:.08em;text-transform:uppercase;font-weight:500">{avail != null && avail < 0 ? 'Acima do orçamento' : 'Disponível no mês'}</div>
        <div data-testid="budget-avail" style="font-size:36px;font-weight:700;letter-spacing:-.03em;margin-top:4px;color:#fff">{avail != null ? mask(hid, fmtBRL(Math.abs(avail))) : 'R$ —'}</div>
        {total != null ? <>
          <div class={`bar ${b.total_spent > total ? 'warn' : ''}`} style="margin-top:14px"><i style={{ width: Math.min(100, pct(b.total_spent, total)) + '%' }} /></div>
          <div class="muted" style="margin-top:8px">{mask(hid, fmtBRL(b.total_spent))} de {mask(hid, fmtBRL(total))} usados · {left} dias restantes</div>
          {avail != null && avail > 0 && left > 0 && <div class="muted" style="margin-top:4px">≈ {mask(hid, fmtBRL(avail / left))} por dia para fechar o mês no limite.</div>}</>
          : <div class="muted" style="margin-top:10px">Defina um limite total para acompanhar quanto ainda pode gastar.</div>}
        <button class="btn-s press" style="margin-top:14px;width:100%" onClick={() => { sheet.value = { k: 'limit', categoryId: null }; }}>{total != null ? 'Alterar orçamento do mês' : 'Definir orçamento do mês'}</button>
      </section>
      <section style="margin-top:26px" aria-label="Limites por categoria">
        <div class="sec-h"><h2>Por categoria</h2></div>
        {limited.length === 0 && unlimited.length === 0 && <Empty icon="wallet" title="Nada por aqui ainda" text="Defina limites por categoria e acompanhe o quanto já foi usado, calculado das suas despesas." />}
        {limited.map((r) => { const u = pct(r.spent, r.limit!); const warn = u >= 80; return (
          <button class="row press" key={r.category_id} style="display:block;padding:14px 0;min-height:76px" onClick={() => { sheet.value = { k: 'limit', categoryId: r.category_id }; }} aria-label={`${catName(r.category_id)}: ${fmtBRL(r.spent)} de ${fmtBRL(r.limit!)}`}>
            <div style="display:flex;align-items:center;gap:12px"><span class="ico" style="width:40px;height:40px"><Icon n={iconFor(catById(r.category_id)?.icon)} size={18} /></span>
              <span style="flex:1;font-weight:600">{catName(r.category_id)}</span>
              {warn && <span class="tag warn"><Icon n="warn" size={12} sw={2.2} />{u >= 100 ? 'Estourou' : 'Perto do limite'}</span>}
              <span style="font-weight:700">{u}%</span></div>
            <div class={`bar ${warn ? 'warn' : ''}`} style="margin-top:10px"><i style={{ width: Math.min(100, u) + '%' }} /></div>
            <div class="muted" style="margin-top:6px">{mask(hid, fmtBRL(r.spent))} de {mask(hid, fmtBRL(r.limit!))}</div>
          </button>); })}
        {unlimited.map((r) => (
          <button class="row press" key={r.category_id} onClick={() => { sheet.value = { k: 'limit', categoryId: r.category_id }; }}>
            <span class="ico" style="width:40px;height:40px"><Icon n={iconFor(catById(r.category_id)?.icon)} size={18} /></span>
            <span style="flex:1;font-weight:600">{catName(r.category_id)}<div class="muted" style="font-weight:400">Sem limite · defina um</div></span><b>{mask(hid, fmtBRL(r.spent))}</b></button>))}
        {free.length > 0 && <details style="margin-top:12px"><summary class="btn-link" style="cursor:pointer;list-style:none;min-height:44px;display:flex;align-items:center">+ Definir limite em outra categoria</summary>
          <div style="display:flex;gap:8px;flex-wrap:wrap;padding:6px 0">{free.map((c) => <button key={c.id} class="chip press" onClick={() => { sheet.value = { k: 'limit', categoryId: c.id }; }}><span>{c.name}</span></button>)}</div></details>}
      </section>
    </div>
  );
}

function GoalsTab() {
  const goals = snap.value.goals, hid = hideBalance.value, t = todayS.value;
  const tot = goals.reduce((a, g) => a + g.saved, 0), target = goals.reduce((a, g) => a + g.target_amount, 0);
  return (
    <div>
      {goals.length > 0 && <section class="card" style="margin-top:18px" aria-label="Total guardado">
        <div class="muted" style="letter-spacing:.08em;text-transform:uppercase;font-weight:500">Total guardado em metas</div>
        <div style="font-size:34px;font-weight:700;letter-spacing:-.03em;margin-top:4px">{mask(hid, fmtBRL(tot))}</div>
        <div class="bar" style="margin-top:12px"><i style={{ width: pct(tot, target) + '%' }} /></div>
        <div class="muted" style="margin-top:8px">{pct(tot, target)}% de {mask(hid, fmtBRL(target))} somando todas as metas</div></section>}
      <button class="btn-p press" style="margin-top:16px" onClick={() => { sheet.value = { k: 'goalform' }; }}><Icon n="plus" size={20} sw={2.2} />Nova meta</button>
      {goals.length === 0 ? <Empty icon="target" title="Defina sua primeira meta" text="Diga o que quer conquistar, quanto precisa juntar e até quando. Mostramos quanto guardar por mês." /> :
        <div style="margin-top:10px">{goals.map((g) => { const s = goalStats(g, t); return (
          <button class="row press" key={g.id} style="display:block;padding:16px 0" onClick={() => { sheet.value = { k: 'goal', id: g.id }; }} aria-label={`${g.name}: ${s.pct}%`}>
            <div style="display:flex;align-items:center;gap:14px"><span class="ico" style="color:var(--lime)"><Icon n={iconFor(g.icon)} size={20} sw={1.7} /></span>
              <span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{g.name}</span><span class="muted">{mask(hid, fmtBRL(g.saved))} de {mask(hid, fmtBRL(g.target_amount))} · até {shortDate(g.deadline)}</span></span>
              <span style="font-size:20px;font-weight:700">{s.pct}%</span></div>
            <div class="bar" style="margin-top:12px"><i style={{ width: s.pct + '%' }} /></div>
            <div style="display:flex;justify-content:space-between;margin-top:8px"><span class={`tag ${s.status === 'behind' || s.status === 'late' ? 'warn' : s.status === 'start' ? 'neutral' : ''}`}>{STATUS_LABEL[s.status]}</span>
              <span class="muted">{s.remaining > 0 && s.daysLeft >= 0 ? `guardar ${mask(hid, fmtBRL(s.needPerMonth))}/mês` : s.remaining === 0 ? 'meta atingida' : ''}</span></div>
          </button>); })}</div>}
    </div>
  );
}
