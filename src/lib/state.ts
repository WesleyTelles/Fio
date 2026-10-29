// Estado global da aplicação (signals). Única fonte para as telas; os dados vêm SEMPRE do backend (api.ts),
// o cache em IndexedDB é só contingência de leitura offline.
import { signal, computed, effect } from '@preact/signals';
import { api } from './api';
import { kv } from './idb';
import { Outbox } from './outbox';
import { flashMascot } from './mascot';
import { supabase } from './supabase';
import { AppError, mapError } from './errors';
import { applyPending, applyPendingBudget } from '../domain/summary';
import { applySeriesPending, SERIES_DAYS, type SeriesPt } from '../domain/chart';
import { addDays, monthEnd, monthStart, todayIn } from '../../supabase/functions/_shared/dates';
import type { BudgetStatus, Category, Goal, PendingOp, Summary, Tx } from '../domain/types';

export interface Profile { display_name: string; timezone: string; opening_balance: number; prefs: Record<string, unknown> }
export type SessionState = { status: 'loading' | 'out' | 'in' | 'recovery'; userId?: string; email?: string; expired?: boolean; name?: string };
export interface Snap { sumMonth: Summary | null; sumWeek: Summary | null; recent: Tx[]; budget: BudgetStatus | null; goals: Goal[]; series?: SeriesPt[] | null; savedAt: string | null }
const EMPTY: Snap = { sumMonth: null, sumWeek: null, recent: [], budget: null, goals: [], series: null, savedAt: null };

export const session = signal<SessionState>({ status: 'loading' });
export const online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
export const profile = signal<Profile | null>(null);
export const categories = signal<Category[]>([]);
export const todayS = signal(todayIn('America/Sao_Paulo'));
export const snap = signal<Snap>(EMPTY);
export const loading = signal(false);
export const loadError = signal<string | null>(null);
export const fromCache = signal(false);
export const lastSyncOk = signal<string | null>(null);

// ---------------------------------------------------------------- UI
export type SheetState =
  | { k: 'txform'; mode: 'new' | 'edit' | 'draft'; tx?: Tx; init?: { type?: 'expense' | 'income'; amount?: string; description?: string; category_id?: string; date?: string }; source?: 'manual' | 'ai'; aiMeta?: Record<string, unknown>; onDone?: (r: { synced: boolean }) => void }
  | { k: 'txdetail'; tx: Tx }
  | { k: 'limit'; categoryId: string | null }
  | { k: 'goalform'; goal?: Goal }
  | { k: 'goal'; id: string }
  | { k: 'gmove'; goalId: string; kind: 'deposit' | 'withdraw' }
  | { k: 'pending' }
  | { k: 'confirm'; title: string; body: string; label: string; danger?: boolean; onConfirm: () => void | Promise<void> };
export const sheet = signal<SheetState | null>(null);
export const toastS = signal<{ text: string; action?: { label: string; run: () => void }; id: number } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, action?: { label: string; run: () => void }) {
  clearTimeout(toastTimer); toastS.value = { text, action, id: Date.now() };
  toastTimer = setTimeout(() => { toastS.value = null; }, action ? 7000 : 4500);
}
export const hideBalance = signal(((): boolean => { try { return localStorage.getItem('fio.hide') === '1'; } catch { return false; } })());
export function setHide(v: boolean) { hideBalance.value = v; try { localStorage.setItem('fio.hide', v ? '1' : '0'); } catch { /* sem storage */ } }

// ---------------------------------------------------------------- rotas
export const ROUTES = ['/', '/movimentacoes', '/orcamento', '/metas', '/insights', '/assistente', '/perfil'] as const;
const norm = (p: string) => { const x = p.replace(/\/+$/, '') || '/'; return x; };
export const route = signal(typeof location === 'undefined' ? '/' : norm(location.pathname));
export function navigate(path: string, replace = false) {
  const p = norm(path.split('?')[0]);
  if (p === route.value && !path.includes('?')) return;
  if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
  route.value = p; window.scrollTo(0, 0);
}
if (typeof window !== 'undefined') window.addEventListener('popstate', () => { route.value = norm(location.pathname); });

// ---------------------------------------------------------------- fila
export const outbox = new Outbox({
  api: { createTx: (k, p) => api.createTx(k, p) },
  userId: () => session.value.userId ?? null,
  online: () => online.value,
  refreshSession: async () => { const { data, error } = await supabase().auth.refreshSession(); return !error && !!data.session; },
  onSynced: () => { lastSyncOk.value = new Date().toISOString(); void refreshAll(); },
});
export const myOps = computed<PendingOp[]>(() => outbox.ops.value.filter((o) => o.user_id === session.value.userId));
export const otherOpsCount = computed(() => outbox.ops.value.filter((o) => o.user_id !== session.value.userId).length);
export const pendingCount = computed(() => myOps.value.filter((o) => o.status !== 'rejected').length);
export const rejectedCount = computed(() => myOps.value.filter((o) => o.status === 'rejected').length);

export type SyncUi = 'offline' | 'syncing' | 'pending' | 'failed' | 'synced' | 'blocked';
export const syncUi = computed<SyncUi>(() => {
  if (outbox.authBlocked.value && pendingCount.value) return 'blocked';
  if (!online.value) return 'offline';
  if (outbox.running.value) return 'syncing';
  if (myOps.value.some((o) => o.status === 'failed' || o.status === 'rejected')) return 'failed';
  if (pendingCount.value) return 'pending';
  return 'synced';
});

/** Resumo/Orçamento/Recentes já com as pendências sobrepostas (e marcadas como tal). */
export const sumMonthV = computed(() => (snap.value.sumMonth ? applyPending(snap.value.sumMonth, myOps.value) : null));
export const sumWeekV = computed(() => (snap.value.sumWeek ? applyPending(snap.value.sumWeek, myOps.value) : null));
export const budgetV = computed(() => (snap.value.budget ? applyPendingBudget(snap.value.budget, myOps.value) : null));
export const seriesV = computed(() => (snap.value.series ? applySeriesPending(snap.value.series, myOps.value) : null));
export const pendingAsTx = (o: PendingOp): Tx => ({ id: o.id, type: o.payload.type, amount: o.payload.amount, description: o.payload.description, category_id: o.payload.category_id,
  occurred_on: o.payload.occurred_on, source: o.payload.source, created_at: o.created_at, updated_at: o.created_at, idempotency_key: o.id, pending: true });
export const recentV = computed<Tx[]>(() => {
  const p = myOps.value.filter((o) => o.status !== 'rejected').map(pendingAsTx).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at));
  return [...p, ...snap.value.recent].slice(0, 5);
});

// ---------------------------------------------------------------- dados
export const catById = (id: string) => categories.value.find((c) => c.id === id);
export const catName = (id: string) => catById(id)?.name ?? 'Outros';
export const expenseCats = computed(() => categories.value.filter((c) => c.kind === 'expense' && !c.archived_at));
export const incomeCats = computed(() => categories.value.filter((c) => c.kind === 'income' && !c.archived_at));
export const aiKeyToId = (key: string) => categories.value.find((c) => (c.slug ?? c.id) === key)?.id;

let seq = 0, running = false, rerun = false;
export async function refreshAll(): Promise<void> {
  const uid = session.value.userId; if (!uid) return;
  if (running) { rerun = true; return; }
  running = true;
  try {
    do {
      rerun = false; const my = ++seq;
      if (!snap.value.sumMonth) loading.value = true;
      try {
        const [prof, cats] = await Promise.all([api.profile(), api.categories()]);
        if (my !== seq || session.value.userId !== uid) continue;
        profile.value = prof; categories.value = cats;
        const t = todayIn(prof.timezone); todayS.value = t;
        const ms = monthStart(t);
        const [sumMonth, sumWeek, rec, budget, goals, series] = await Promise.all([
          api.summary(ms, monthEnd(t), t), api.summary(addDays(t, -6), t, t), api.list({ limit: 5 }), api.budget(ms), api.goals(),
          api.balanceSeries(addDays(t, -SERIES_DAYS + 1), t).catch(() => null)]); // o gráfico é complementar: se falhar, o resto da tela carrega
        if (my !== seq || session.value.userId !== uid) continue;
        const next: Snap = { sumMonth, sumWeek, recent: rec.items, budget, goals, series, savedAt: new Date().toISOString() };
        snap.value = next; fromCache.value = false; loadError.value = null;
        void kv.set('snap:' + uid, { snap: next, profile: prof, categories: cats }).catch(() => {});
      } catch (e) {
        const err = mapError(e);
        if (err.kind === 'network') { fromCache.value = !!snap.value.savedAt; loadError.value = snap.value.savedAt ? null : 'offline'; }
        else if (err.kind === 'auth') { outbox.authBlocked.value = true; loadError.value = err.message; }
        else loadError.value = err.message;
      } finally { loading.value = false; }
    } while (rerun);
  } finally { running = false; }
}

export async function loadSnapshot(uid: string) {
  try {
    const s = await kv.get<{ snap: Snap; profile: Profile; categories: Category[] }>('snap:' + uid);
    if (s && session.value.userId === uid) { snap.value = s.snap; profile.value = s.profile; categories.value = s.categories; todayS.value = todayIn(s.profile.timezone); fromCache.value = true; }
  } catch { /* IndexedDB indisponível: segue só com rede */ }
}
export function resetData() { seq++; snap.value = EMPTY; profile.value = null; categories.value = []; loadError.value = null; fromCache.value = false; sheet.value = null; }

// ---------------------------------------------------------------- criar lançamento (fila primeiro)
export interface CreateResult { synced: boolean; rejected?: AppError; opId: string }
/**
 * Fluxo único para criar lançamentos (manual e IA): grava na fila persistente, tenta enviar agora.
 * - synced:true  → o servidor confirmou (ou já tinha) o lançamento.
 * - synced:false → ficou guardado no aparelho como PENDENTE (offline / falha de rede / sessão).
 * - rejected     → o servidor recusou por regra de negócio; nada foi guardado, o formulário continua aberto.
 */
export async function createTransaction(payload: import('../domain/types').TxPayload, key: string): Promise<CreateResult> {
  const op = await outbox.enqueue(payload, key);
  await outbox.sync();
  const cur = outbox.ops.value.find((o) => o.id === op.id);
  if (!cur) { flashMascot('happy'); return { synced: true, opId: op.id }; }   // saiu da fila = o servidor confirmou
  if (cur.status === 'rejected') {
    await outbox.discard(op.id);                      // devolve o controle ao formulário, sem deixar lixo na fila
    flashMascot('oops');
    return { synced: false, opId: op.id, rejected: new AppError('validation', 'rejected', cur.error ?? 'Lançamento recusado.') };
  }
  return { synced: false, opId: op.id };              // pendente (offline/falha): a mascote NÃO celebra
}

// ---------------------------------------------------------------- rede e ciclo de vida
export function startLifecycle() {
  const goOnline = () => { online.value = true; void outbox.sync(); void refreshAll(); };
  window.addEventListener('online', goOnline);
  window.addEventListener('offline', () => { online.value = false; });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || session.value.status !== 'in') return;
    const p = profile.value; if (p) todayS.value = todayIn(p.timezone);
    void outbox.sync(); void refreshAll();
  });
  setInterval(() => { const p = profile.value; if (p) { const t = todayIn(p.timezone); if (t !== todayS.value) { todayS.value = t; void refreshAll(); } } if (pendingCount.value && online.value) void outbox.sync(); }, 30000);
  effect(() => { /* quando a conexão volta com pendências, sincroniza */ if (online.value && session.value.status === 'in' && pendingCount.value) void outbox.sync(); });
}
