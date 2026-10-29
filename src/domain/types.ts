export type TxType = 'expense' | 'income';
export interface Category { id: string; user_id: string | null; slug: string | null; name: string; kind: TxType; color: string; icon: string; archived_at: string | null }
export interface Tx {
  id: string; type: TxType; amount: number; description: string; category_id: string; occurred_on: string;
  source: 'manual' | 'ai'; created_at: string; updated_at: string; idempotency_key: string;
  /** só no cliente: lançamento ainda não confirmado pelo servidor */
  pending?: boolean;
}
export interface CatTotal { category_id: string; type: TxType; amount: number; count: number }
export interface Summary { from: string; to: string; as_of: string; balance: number; inflow: number; outflow: number; count: number; by_category: CatTotal[] }
export interface BudgetRow { category_id: string; limit: number | null; spent: number }
export interface BudgetStatus { month: string; total_limit: number | null; total_spent: number; categories: BudgetRow[] }
export interface Goal {
  id: string; name: string; target_amount: number; deadline: string; icon: string; created_at: string;
  saved: number; last_move_on: string | null; first_move_on: string | null;
}
export interface GoalMove { id: string; kind: 'deposit' | 'withdraw'; amount: number; occurred_on: string; counts_in_balance: boolean; created_at: string }

export interface TxPayload { type: TxType; amount: number; description: string; category_id: string; occurred_on: string; source: 'manual' | 'ai'; ai_meta?: Record<string, unknown> | null }
export type OpStatus = 'pending' | 'syncing' | 'failed' | 'rejected';
/** Operação criada offline (ou com falha de rede) aguardando sincronização. id == chave de idempotência. */
export interface PendingOp { id: string; user_id: string; kind: 'create_tx'; payload: TxPayload; created_at: string; status: OpStatus; attempts: number; error?: string }
