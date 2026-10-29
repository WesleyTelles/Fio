// ÚNICA camada que fala com o backend. Telas e sincronização usam só estas funções.
// Nenhuma função recebe user_id: a identidade vem do JWT validado no servidor.
import { supabase } from './supabase';
import { AppError, mapError } from './errors';
import type { SeriesPt } from '../domain/chart';
import type { BudgetStatus, Category, Goal, GoalMove, Summary, Tx, TxPayload, TxType } from '../domain/types';
import type { InterpretResult } from '../../supabase/functions/_shared/schema';

type Res = { data: any; error: any; status?: number };
async function call<T>(p: PromiseLike<Res>): Promise<T> {
  let r: Res;
  try { r = await p; } catch (e) { throw mapError(e); }
  if (r.error) throw mapError(r.error, r.status);
  return r.data as T;
}
const n = (x: any) => (x == null ? x : Number(x));
const fixTx = (t: any): Tx => ({ ...t, amount: n(t.amount) });
const fixSummary = (s: any): Summary => ({ ...s, balance: n(s.balance), inflow: n(s.inflow), outflow: n(s.outflow), by_category: (s.by_category ?? []).map((c: any) => ({ ...c, amount: n(c.amount) })) });
const fixGoal = (g: any): Goal => ({ ...g, target_amount: n(g.target_amount), saved: n(g.saved) });

export interface ListParams { from?: string | null; to?: string | null; category?: string | null; type?: TxType | null; q?: string | null; limit?: number; cursor?: unknown }
export interface InterpretResponse { mode: 'demo' | 'ai'; result: InterpretResult }

export const api = {
  async profile() {
    const d = await call<any>(supabase().from('profiles').select('display_name,timezone,opening_balance,prefs').single());
    return { ...d, opening_balance: n(d.opening_balance) } as { display_name: string; timezone: string; opening_balance: number; prefs: Record<string, unknown> };
  },
  updateProfile: (patch: Partial<{ display_name: string; timezone: string; opening_balance: number; prefs: Record<string, unknown> }>, userId: string) =>
    call<null>(supabase().from('profiles').update(patch).eq('user_id', userId)),

  categories: () => call<Category[]>(supabase().from('categories').select('id,user_id,slug,name,kind,color,icon,archived_at').order('name')),
  createCategory: (userId: string, name: string, kind: TxType) => call<null>(supabase().from('categories').insert({ user_id: userId, name, kind })),
  archiveCategory: (id: string) => call<null>(supabase().from('categories').update({ archived_at: new Date().toISOString() }).eq('id', id)),

  async summary(from: string, to: string, asOf: string) { return fixSummary(await call(supabase().rpc('get_summary', { p_from: from, p_to: to, p_as_of: asOf }))); },
  async balanceSeries(from: string, to: string) {
    const d = await call<Array<{ d: string; balance: number | string }>>(supabase().rpc('get_balance_series', { p_from: from, p_to: to }));
    return d.map((x) => ({ d: x.d, balance: n(x.balance) as number })) as SeriesPt[];
  },
  async list(p: ListParams) {
    const d = await call<{ items: any[]; next_cursor: unknown }>(supabase().rpc('list_transactions', {
      p_from: p.from ?? null, p_to: p.to ?? null, p_category: p.category ?? null, p_type: p.type ?? null, p_q: p.q ?? null, p_limit: p.limit ?? 30, p_cursor: p.cursor ?? null }));
    return { items: d.items.map(fixTx), next: d.next_cursor };
  },
  async createTx(key: string, t: TxPayload) {
    const d = await call<any>(supabase().rpc('create_transaction', { p_key: key, p_type: t.type, p_amount: t.amount, p_description: t.description,
      p_category_id: t.category_id, p_date: t.occurred_on, p_source: t.source, p_ai_meta: t.ai_meta ?? null }));
    return { tx: fixTx(d), duplicate: !!d.duplicate };
  },
  async updateTx(id: string, t: Omit<TxPayload, 'source' | 'ai_meta'>, expected: string) {
    return fixTx(await call(supabase().rpc('update_transaction', { p_id: id, p_type: t.type, p_amount: t.amount, p_description: t.description,
      p_category_id: t.category_id, p_date: t.occurred_on, p_expected_updated_at: expected })));
  },
  deleteTx: (id: string) => call<unknown>(supabase().rpc('delete_transaction', { p_id: id })),
  restoreTx: (id: string) => call<unknown>(supabase().rpc('restore_transaction', { p_id: id })),

  async budget(month: string) {
    const d = await call<any>(supabase().rpc('get_budget_status', { p_month: month }));
    return { ...d, total_limit: n(d.total_limit), total_spent: n(d.total_spent), categories: d.categories.map((c: any) => ({ ...c, limit: n(c.limit), spent: n(c.spent) })) } as BudgetStatus;
  },
  setBudget: (month: string, category: string | null, limit: number) => call<unknown>(supabase().rpc('upsert_budget', { p_month: month, p_category: category, p_limit: limit })),
  clearBudget: (month: string, category: string | null) => call<unknown>(supabase().rpc('delete_budget', { p_month: month, p_category: category })),

  async goals() { return (await call<any[]>(supabase().rpc('list_goals'))).map(fixGoal); },
  async goalMoves(id: string) { return (await call<any[]>(supabase().rpc('list_goal_moves', { p_goal: id, p_limit: 20 }))).map((m) => ({ ...m, amount: n(m.amount) })) as GoalMove[]; },
  createGoal: (key: string, name: string, target: number, deadline: string, icon: string, initial: number, today: string) =>
    call<unknown>(supabase().rpc('create_goal', { p_key: key, p_name: name, p_target: target, p_deadline: deadline, p_icon: icon, p_initial: initial, p_today: today })),
  updateGoal: (id: string, patch: { name: string; target_amount: number; deadline: string; icon: string }) => call<null>(supabase().from('goals').update(patch).eq('id', id)),
  deleteGoal: (id: string) => call<null>(supabase().from('goals').delete().eq('id', id)),
  goalMove: (key: string, goal: string, kind: 'deposit' | 'withdraw', amount: number, date: string) =>
    call<unknown>(supabase().rpc('goal_move', { p_key: key, p_goal: goal, p_kind: kind, p_amount: amount, p_date: date })),

  async interpret(text: string, today: string): Promise<InterpretResponse> {
    const { data, error, response } = await supabase().functions.invoke('interpret', { body: { text, today } });
    if (error) {
      let code = 'unavailable', msg = 'O assistente está indisponível.';
      try { const j = await (error as any).context?.json?.(); code = j?.error?.code ?? code; msg = j?.error?.message ?? msg; } catch { /* corpo ausente */ }
      const st = (error as any).context?.status ?? response?.status;
      if (code === 'ai_disabled') throw new AppError('disabled', code, msg);
      if (st === 401) throw new AppError('auth', 'auth', 'Sua sessão expirou. Entre novamente.');
      if (st === 429) throw new AppError('rate', code, msg);
      if (/fetch|network/i.test(String(error.message)) && !st) throw new AppError('network', 'network', 'Sem conexão com o servidor.');
      throw new AppError('server', code, msg);
    }
    return data as InterpretResponse;
  },

  async aiMode(): Promise<'demo' | 'ai' | 'off'> {
    const { data, error } = await supabase().functions.invoke('interpret', { method: 'GET' });
    if (error) throw error;
    return (data as { mode: 'demo' | 'ai' | 'off' }).mode;
  },

  exportData: () => call<unknown>(supabase().rpc('export_my_data')),
  deleteAccount: (confirm: string) => call<unknown>(supabase().rpc('delete_my_account', { p_confirm: confirm })),
};
export type Api = typeof api;
