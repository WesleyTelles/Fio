import { toCents } from '../../supabase/functions/_shared/money.ts';
import type { BudgetStatus, CatTotal, PendingOp, Summary } from './types.ts';

const c = toCents;
const live = (ops: PendingOp[]) => ops.filter((o) => o.kind === 'create_tx' && o.status !== 'rejected');

/** Sobrepõe lançamentos pendentes ao resumo do servidor, sem alterar o original. Usa centavos (sem erro de float). */
export function applyPending(s: Summary, ops: PendingOp[]): Summary {
  let bal = c(s.balance), inn = c(s.inflow), out = c(s.outflow), cnt = s.count;
  const cats = new Map<string, { type: CatTotal['type']; amt: number; n: number }>();
  for (const x of s.by_category) cats.set(x.category_id + '|' + x.type, { type: x.type, amt: c(x.amount), n: x.count });
  for (const o of live(ops)) {
    const p = o.payload, v = c(p.amount), sign = p.type === 'income' ? 1 : -1;
    if (p.occurred_on <= s.as_of) bal += sign * v;
    if (p.occurred_on >= s.from && p.occurred_on <= s.to) {
      if (p.type === 'income') inn += v; else out += v;
      cnt += 1;
      const k = p.category_id + '|' + p.type, cur = cats.get(k) ?? { type: p.type, amt: 0, n: 0 };
      cats.set(k, { type: p.type, amt: cur.amt + v, n: cur.n + 1 });
    }
  }
  const by_category = [...cats.entries()].map(([k, v]) => ({ category_id: k.split('|')[0], type: v.type, amount: v.amt / 100, count: v.n }))
    .sort((a, b) => b.amount - a.amount);
  return { ...s, balance: bal / 100, inflow: inn / 100, outflow: out / 100, count: cnt, by_category };
}

export function applyPendingBudget(b: BudgetStatus, ops: PendingOp[]): BudgetStatus {
  const m0 = b.month, m1 = m0.slice(0, 8) + '31';
  const rows = new Map(b.categories.map((r) => [r.category_id, { limit: r.limit, spent: c(r.spent) }]));
  let tot = c(b.total_spent);
  for (const o of live(ops)) {
    const p = o.payload;
    if (p.type !== 'expense' || p.occurred_on < m0 || p.occurred_on > m1) continue;
    tot += c(p.amount);
    const r = rows.get(p.category_id) ?? { limit: null, spent: 0 };
    rows.set(p.category_id, { limit: r.limit, spent: r.spent + c(p.amount) });
  }
  const categories = [...rows.entries()].map(([category_id, r]) => ({ category_id, limit: r.limit, spent: r.spent / 100 })).sort((a, z) => z.spent - a.spent);
  return { ...b, total_spent: tot / 100, categories };
}

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
