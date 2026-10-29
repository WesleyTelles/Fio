import { Icon } from './Icon';
import { iconFor } from './ui';
import { catById } from '../lib/state';
import { fmtBRL } from '../../supabase/functions/_shared/money';
import type { Tx } from '../domain/types';

export function TxRow({ tx, when, onOpen, hidden }: { tx: Tx; when: string; onOpen: () => void; hidden?: boolean }) {
  const c = catById(tx.category_id);
  return (
    <button class="row press" onClick={onOpen} aria-label={`${tx.description}, ${tx.type === 'income' ? 'entrada' : 'saída'} de ${fmtBRL(tx.amount)}${tx.pending ? ', pendente de sincronização' : ''}`}>
      <span class="ico"><Icon n={iconFor(c?.icon)} size={20} sw={1.7} /></span>
      <span style="flex:1;min-width:0;display:flex;flex-direction:column">
        <span style="font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{tx.description}</span>
        <span class="muted">{c?.name ?? 'Outros'} · {when}{tx.pending && <span style="color:var(--lime);font-weight:600"> · Pendente</span>}</span>
      </span>
      <span style="display:flex;flex-direction:column;align-items:flex-end">
        <span style={{ fontSize: '15px', fontWeight: 700, color: tx.type === 'income' ? 'var(--lime)' : '#fff' }}>{hidden ? '••••' : (tx.type === 'income' ? '+' : '−') + fmtBRL(tx.amount)}</span>
        <span style="font-size:11px;color:var(--gray2)">{tx.type === 'income' ? 'Entrada' : 'Saída'}</span>
      </span>
    </button>
  );
}
