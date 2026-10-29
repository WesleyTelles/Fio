import { sheet } from '../lib/state';
import { ConfirmSheet, PendingSheet, TxDetail, TxForm } from './TxSheets';
import { GoalDetail, GoalForm, GoalMoveSheet, LimitSheet } from './BudgetGoalSheets';

/** Renderiza a sheet ativa (apenas uma por vez). */
export function Sheets() {
  const s = sheet.value; if (!s) return null;
  switch (s.k) {
    case 'txform': return <TxForm {...s} key={'f' + (s.tx?.id ?? '') + s.mode} />;
    case 'txdetail': return <TxDetail tx={s.tx} />;
    case 'limit': return <LimitSheet categoryId={s.categoryId} key={s.categoryId ?? 'tot'} />;
    case 'goalform': return <GoalForm goal={s.goal} key={s.goal?.id ?? 'new'} />;
    case 'goal': return <GoalDetail id={s.id} />;
    case 'gmove': return <GoalMoveSheet goalId={s.goalId} kind={s.kind} key={s.goalId + s.kind} />;
    case 'pending': return <PendingSheet />;
    case 'confirm': return <ConfirmSheet {...s} />;
  }
}
