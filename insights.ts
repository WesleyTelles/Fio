import { fmtBRL, toCents } from '../../supabase/functions/_shared/money.ts';
import { daysInMonth, monthLabel, shortDate, addMonths } from '../../supabase/functions/_shared/dates.ts';
import { goalStats } from './goals.ts';
import type { BudgetStatus, Category, Goal, Summary } from './types.ts';
import { pct } from './summary.ts';

export interface Insight { id: string; tone: 'alert' | 'info' | 'good'; title: string; body: string; basis: string }
export interface InsightInput {
  today: string;
  /** do dia 1 até hoje */ current: Summary;
  /** mesmo recorte (dia 1 até o mesmo dia) do mês anterior */ previous: Summary;
  budget: BudgetStatus;
  categories: Category[];
  goals: Goal[];
}

/** Insights 100% calculados dos dados reais (regras e limiares fixos, sem texto de IA armazenado). */
export function computeInsights(i: InsightInput): Insight[] {
  const out: Insight[] = [];
  const name = (id: string) => i.categories.find((c) => c.id === id)?.name ?? 'Outros';
  const day = Number(i.today.slice(8, 10)), dim = daysInMonth(i.today);
  const range = `01 a ${shortDate(i.today)}`;
  const exp = i.current.by_category.filter((c) => c.type === 'expense');
  const prevExp = new Map(i.previous.by_category.filter((c) => c.type === 'expense').map((c) => [c.category_id, c.amount]));
  const prevName = monthLabel(addMonths(i.today.slice(0, 8) + '01', -1)).split(' ')[0].toLowerCase();

  if (exp.length && i.current.outflow > 0) {
    const top = exp[0];
    out.push({ id: 'top-cat', tone: 'info', title: `${name(top.category_id)} concentra ${pct(top.amount, i.current.outflow)}% das saídas`,
      body: `${fmtBRL(top.amount)} de ${fmtBRL(i.current.outflow)} gastos no mês.`, basis: `Soma das despesas de ${range}.` });
  }
  for (const c of exp.slice(0, 3)) {
    const p = prevExp.get(c.category_id);
    if (!p || p <= 0) continue;
    const ch = Math.round(((c.amount - p) / p) * 100);
    if (Math.abs(ch) < 10) continue;
    out.push({ id: 'vs-' + c.category_id, tone: ch < 0 ? 'good' : 'info',
      title: `${name(c.category_id)} ${ch < 0 ? 'caiu' : 'subiu'} ${Math.abs(ch)}% vs. ${prevName}`,
      body: `${fmtBRL(c.amount)} agora, ${fmtBRL(p)} no mesmo período do mês anterior.`, basis: `Compara ${range} com o mesmo recorte de ${prevName}.` });
  }
  for (const b of i.budget.categories) {
    if (b.limit == null) continue;
    const u = pct(b.spent, b.limit);
    if (u >= 100) out.push({ id: 'over-' + b.category_id, tone: 'alert', title: `${name(b.category_id)} passou do limite`,
      body: `${fmtBRL(b.spent)} de ${fmtBRL(b.limit)} (${u}%).`, basis: 'Despesas do mês ÷ limite definido.' });
    else if (u >= 80) out.push({ id: 'near-' + b.category_id, tone: 'alert', title: `${name(b.category_id)} perto do limite`,
      body: `${fmtBRL(b.spent)} de ${fmtBRL(b.limit)} (${u}%). Restam ${fmtBRL(b.limit - b.spent)}.`, basis: 'Alerta a partir de 80% do limite.' });
  }
  if (i.budget.total_limit && day >= 5 && i.budget.total_spent > 0) {
    const proj = Math.round((toCents(i.budget.total_spent) / day) * dim) / 100;
    if (proj > i.budget.total_limit)
      out.push({ id: 'projection', tone: 'alert', title: 'No ritmo atual, o orçamento do mês estoura',
        body: `Projeção de ${fmtBRL(proj)} para um orçamento de ${fmtBRL(i.budget.total_limit)}.`,
        basis: `Estimativa: média diária de ${fmtBRL(i.budget.total_spent / day)} × ${dim} dias. Não é previsão garantida.` });
  }
  const open = i.goals.map((g) => ({ g, s: goalStats(g, i.today) })).filter((x) => x.s.status !== 'done').sort((a, b) => a.g.deadline.localeCompare(b.g.deadline))[0];
  if (open) {
    const { g, s } = open;
    if (s.daysLeft < 0) out.push({ id: 'goal-late', tone: 'alert', title: `O prazo de “${g.name}” venceu`, body: `Faltam ${fmtBRL(s.remaining)}. Ajuste o prazo ou o valor.`, basis: 'Prazo anterior a hoje.' });
    else out.push({ id: 'goal-need', tone: 'info', title: `Para “${g.name}”, guarde ${fmtBRL(s.needPerMonth)} por mês`,
      body: `Faltam ${fmtBRL(s.remaining)} em ${s.daysLeft} dias.`, basis: 'Calculado: o que falta ÷ meses restantes (dias ÷ 30,4375).' });
    if (s.eta) out.push({ id: 'goal-eta', tone: s.status === 'on_track' ? 'good' : 'alert',
      title: s.status === 'on_track' ? `“${g.name}” deve ficar pronta antes do prazo` : `“${g.name}” deve atrasar no ritmo atual`,
      body: `Estimativa de conclusão: ${shortDate(s.eta)} ${s.eta.slice(0, 4)} (prazo ${shortDate(g.deadline)} ${g.deadline.slice(0, 4)}).`,
      basis: `Estimativa com ritmo médio de ${fmtBRL(s.pacePerMonth ?? 0)}/mês desde o 1º aporte. Muda se o ritmo mudar.` });
  }
  return out;
}
