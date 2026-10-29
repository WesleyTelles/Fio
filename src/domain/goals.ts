import { addDays, daysBetween } from '../../supabase/functions/_shared/dates.ts';
import type { Goal } from './types.ts';

export type GoalStatus = 'done' | 'late' | 'on_track' | 'behind' | 'start';
export interface GoalStats {
  remaining: number; pct: number; daysLeft: number; needPerMonth: number; needPerWeek: number;
  pacePerMonth: number | null; eta: string | null; status: GoalStatus;
}
const MONTH = 30.4375;
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Cálculo reproduzível (premissas visíveis na UI):
 *  - "Calculado": o que falta ÷ meses restantes até o prazo (dias ÷ 30,4375).
 *  - "Estimativa": ritmo médio de aportes desde o 1º movimento (mín. 30 dias) projetado para o que falta.
 */
export function goalStats(g: Goal, today: string): GoalStats {
  const remaining = r2(Math.max(0, g.target_amount - g.saved));
  const pct = Math.min(100, Math.round((g.saved / g.target_amount) * 100));
  const daysLeft = daysBetween(today, g.deadline);
  const months = Math.max(daysLeft / MONTH, 0);
  const needPerMonth = remaining === 0 ? 0 : r2(remaining / Math.max(months, 1 / MONTH));
  const needPerWeek = remaining === 0 ? 0 : r2(remaining / Math.max(daysLeft / 7, 1 / 7));
  let pace: number | null = null, eta: string | null = null;
  if (g.first_move_on && g.saved > 0) {
    const elapsed = Math.max(daysBetween(g.first_move_on, today), 30);
    pace = r2(g.saved / (elapsed / MONTH));
    if (remaining > 0 && pace > 0) eta = addDays(today, Math.ceil((remaining / pace) * MONTH));
  }
  let status: GoalStatus;
  if (remaining === 0) status = 'done';
  else if (daysLeft < 0) status = 'late';
  else if (pace == null) status = 'start';
  else status = eta != null && eta <= g.deadline ? 'on_track' : 'behind';
  return { remaining, pct, daysLeft, needPerMonth, needPerWeek, pacePerMonth: pace, eta, status };
}

export const STATUS_LABEL: Record<GoalStatus, string> = {
  done: 'Concluída', late: 'Prazo vencido', on_track: 'No ritmo', behind: 'Abaixo do ritmo', start: 'Sem histórico',
};
