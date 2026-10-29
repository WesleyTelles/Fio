import { describe, it, expect } from 'vitest';
import { applyPending, applyPendingBudget } from '../../src/domain/summary.ts';
import { goalStats } from '../../src/domain/goals.ts';
import { computeInsights } from '../../src/domain/insights.ts';
import type { BudgetStatus, Category, Goal, PendingOp, Summary } from '../../src/domain/types.ts';

const S: Summary = { from: '2026-10-01', to: '2026-10-31', as_of: '2026-10-21', balance: 100, inflow: 3200, outflow: 1153.1, count: 20, by_category: [{ category_id: 'alim', type: 'expense', amount: 322.8, count: 4 }] };
const op = (p: Partial<PendingOp['payload']>, status: PendingOp['status'] = 'pending'): PendingOp => ({ id: crypto.randomUUID(), user_id: 'u', kind: 'create_tx', created_at: '', status, attempts: 0, payload: { type: 'expense', amount: 8, description: 'Coxinha', category_id: 'alim', occurred_on: '2026-10-21', source: 'manual', ...p } });

describe('pendentes sobre o resumo do servidor', () => {
  it('despesa pendente de R$ 8: saldo −8, saídas +8, categoria +8', () => {
    const r = applyPending(S, [op({})]);
    expect(r.balance).toBe(92); expect(r.outflow).toBe(1161.1); expect(r.count).toBe(21);
    expect(r.by_category[0]).toMatchObject({ category_id: 'alim', amount: 330.8, count: 5 });
    expect(S.balance).toBe(100); // original intacto
  });
  it('receita pendente e sem erro de float', () => { const r = applyPending({ ...S, balance: 0.1, inflow: 0, outflow: 0, by_category: [] }, [op({ type: 'income', amount: 0.2, category_id: 'sal' })]); expect(r.balance).toBe(0.3); expect(r.inflow).toBe(0.2); });
  it('fora do período não altera entradas/saídas; futuro ao as_of não altera saldo; rejeitadas são ignoradas', () => {
    expect(applyPending(S, [op({ occurred_on: '2026-09-30' })]).outflow).toBe(1153.1);
    expect(applyPending(S, [op({ occurred_on: '2026-10-25' })]).balance).toBe(100);
    expect(applyPending(S, [op({}, 'rejected')])).toEqual(S);
  });
  it('orçamento', () => {
    const b: BudgetStatus = { month: '2026-10-01', total_limit: 2000, total_spent: 1153.1, categories: [{ category_id: 'alim', limit: 450, spent: 322.8 }] };
    const r = applyPendingBudget(b, [op({}), op({ category_id: 'lazer', amount: 10 }), op({ type: 'income', amount: 5, category_id: 'sal' })]);
    expect(r.total_spent).toBe(1171.1); expect(r.categories.find((c) => c.category_id === 'alim')!.spent).toBe(330.8); expect(r.categories.find((c) => c.category_id === 'lazer')).toMatchObject({ limit: null, spent: 10 });
  });
});

const G = (o: Partial<Goal> = {}): Goal => ({ id: 'g', name: 'Viagem', target_amount: 3000, deadline: '2026-12-20', icon: 'plane', created_at: '', saved: 1200, first_move_on: '2026-08-15', last_move_on: '2026-09-25', ...o });
describe('metas', () => {
  it('cálculo e estimativa', () => {
    const s = goalStats(G(), '2026-10-21');
    expect(s).toMatchObject({ remaining: 1800, pct: 40, daysLeft: 60 });
    expect(s.needPerMonth).toBeCloseTo(1800 / (60 / 30.4375), 1);
    expect(s.pacePerMonth).toBeGreaterThan(0); expect(s.eta).not.toBeNull();
  });
  it('estados', () => {
    expect(goalStats(G({ saved: 3000 }), '2026-10-21').status).toBe('done');
    expect(goalStats(G(), '2027-01-01').status).toBe('late');
    expect(goalStats(G({ saved: 0, first_move_on: null }), '2026-10-21').status).toBe('start');
    expect(goalStats(G({ saved: 3000 }), '2026-10-21')).toMatchObject({ needPerMonth: 0, remaining: 0, pct: 100 });
    expect(goalStats(G({ saved: 100, first_move_on: '2026-10-01' }), '2026-10-21').status).toBe('behind');
    expect(goalStats(G({ saved: 2900, first_move_on: '2026-06-01' }), '2026-10-21').status).toBe('on_track');
  });
});

describe('insights reproduzíveis', () => {
  const cats = [{ id: 'alim', name: 'Alimentação' }, { id: 'transp', name: 'Transporte' }] as Category[];
  const cur: Summary = { ...S, to: '2026-10-21', outflow: 1153.1, by_category: [{ category_id: 'alim', type: 'expense', amount: 322.8, count: 4 }, { category_id: 'transp', type: 'expense', amount: 168.3, count: 3 }] };
  const prev: Summary = { ...cur, by_category: [{ category_id: 'transp', type: 'expense', amount: 191.25, count: 3 }] };
  const budget: BudgetStatus = { month: '2026-10-01', total_limit: 1000, total_spent: 1153.1, categories: [{ category_id: 'alim', limit: 450, spent: 322.8 }, { category_id: 'transp', limit: 170, spent: 168.3 }] };
  const ins = computeInsights({ today: '2026-10-21', current: cur, previous: prev, budget, categories: cats, goals: [G()] });
  it('regras e números', () => {
    expect(ins.find((i) => i.id === 'top-cat')!.title).toContain('28%');
    expect(ins.find((i) => i.id === 'vs-transp')!.title).toContain('caiu 12%');
    expect(ins.find((i) => i.id === 'near-transp')).toBeTruthy();
    expect(ins.find((i) => i.id === 'near-alim')).toBeFalsy(); // 71% < 80%
    expect(ins.find((i) => i.id === 'projection')).toBeTruthy();
    expect(ins.find((i) => i.id === 'goal-need')!.body).toContain('60 dias');
  });
  it('todo insight explica sua base de cálculo', () => { for (const i of ins) expect(i.basis.length).toBeGreaterThan(10); });
  it('determinístico e vazio quando não há dados', () => {
    expect(computeInsights({ today: '2026-10-21', current: cur, previous: prev, budget, categories: cats, goals: [G()] })).toEqual(ins);
    expect(computeInsights({ today: '2026-10-21', current: { ...cur, outflow: 0, by_category: [] }, previous: { ...prev, by_category: [] }, budget: { month: '2026-10-01', total_limit: null, total_spent: 0, categories: [] }, categories: cats, goals: [] })).toEqual([]);
  });
});
