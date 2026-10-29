import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet, closeSheet, Field, OfflineNote } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { api } from '../lib/api';
import { mapError } from '../lib/errors';
import { budgetV, catName, online, refreshAll, sheet, snap, todayS, toast } from '../lib/state';
import { fmtBRL, parseBRL } from '../../supabase/functions/_shared/money';
import { addDays, isISODate, longDate, monthStart, shortDate } from '../../supabase/functions/_shared/dates';
import { goalStats, STATUS_LABEL } from '../domain/goals';
import type { Goal, GoalMove } from '../domain/types';

const errOf = (e: unknown) => mapError(e).message;

// ------------------------------------------------------------- limite
export function LimitSheet({ categoryId }: { categoryId: string | null }) {
  const month = monthStart(todayS.value);
  const row = categoryId ? budgetV.value?.categories.find((c) => c.category_id === categoryId) : null;
  const cur = categoryId ? row?.limit ?? null : budgetV.value?.total_limit ?? null;
  const [v, setV] = useState(cur ? String(cur).replace('.', ',') : '');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const name = categoryId ? catName(categoryId) : 'Orçamento total do mês';
  const save = async (e: Event) => {
    e.preventDefault(); if (busy) return;
    const n = parseBRL(v); if (n == null) return setErr('Informe um valor maior que zero, ex.: 450,00.');
    setBusy(true); setErr('');
    try { await api.setBudget(month, categoryId, n); await refreshAll(); toast('Limite salvo.'); closeSheet(); } catch (x) { setErr(errOf(x)); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await api.clearBudget(month, categoryId); await refreshAll(); toast('Limite removido.'); closeSheet(); } catch (x) { setErr(errOf(x)); } finally { setBusy(false); }
  };
  return (
    <Sheet title={name} onClose={closeSheet} busy={busy}>
      <form onSubmit={save} noValidate style="display:flex;flex-direction:column;gap:14px">
        <OfflineNote />
        <Field id="lim" label="Limite mensal (R$)" error={err}><input id="lim" class="input" inputMode="decimal" placeholder="0,00" value={v} onInput={(e) => setV((e.target as HTMLInputElement).value)} aria-invalid={!!err} style="font-size:22px;font-weight:700" /></Field>
        <p class="muted">O “usado” é calculado das suas despesas do mês; só o limite fica salvo.</p>
        <button class="btn-p press" type="submit" disabled={busy || !online.value}>{busy ? 'Salvando…' : 'Salvar limite'}</button>
        {cur != null && <button type="button" class="btn-s btn-d press" onClick={remove} disabled={busy || !online.value}>Remover limite</button>}
      </form>
    </Sheet>
  );
}

// -------------------------------------------------------------- metas
export const GOAL_ICONS: IconName[] = ['target', 'plane', 'shield', 'laptop', 'gift', 'home'];
const ICON_LABEL: Record<string, string> = { target: 'Alvo', plane: 'Viagem', shield: 'Reserva', laptop: 'Eletrônico', gift: 'Presente', home: 'Casa' };

export function GoalForm({ goal }: { goal?: Goal }) {
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? String(goal.target_amount).replace('.', ',') : '');
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const [saved, setSaved] = useState('');
  const [icon, setIcon] = useState<string>(goal?.icon ?? 'target');
  const [errs, setErrs] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [formErr, setFormErr] = useState('');
  const key = useRef(crypto.randomUUID());
  const t = parseBRL(target), ini = saved.trim() ? parseBRL(saved) : 0;
  const tomorrow = addDays(todayS.value, 1);
  const prev = t && isISODate(deadline) && deadline >= tomorrow ? goalStats({ id: 'x', name, target_amount: t, deadline, icon, created_at: '', saved: ini ?? 0, last_move_on: null, first_move_on: null }, todayS.value) : null;
  const save = async (e: Event) => {
    e.preventDefault(); if (busy) return;
    const er: Record<string, string> = {};
    if (!name.trim()) er.name = 'Dê um nome para a meta.';
    if (t == null) er.target = 'Informe quanto você quer juntar.';
    if (!isISODate(deadline) || deadline < tomorrow) er.deadline = 'Escolha uma data futura.';
    if (!goal && ini == null) er.saved = 'Valor inválido.';
    if (!goal && t != null && ini != null && ini > t) er.saved = 'O que já guardou não pode passar da meta.';
    setErrs(er); if (Object.keys(er).length) return;
    setBusy(true); setFormErr('');
    try {
      if (goal) await api.updateGoal(goal.id, { name: name.trim(), target_amount: t!, deadline, icon });
      else await api.createGoal(key.current, name.trim(), t!, deadline, icon, ini ?? 0, todayS.value);
      await refreshAll(); toast(goal ? 'Meta atualizada.' : 'Meta criada.'); closeSheet();
    } catch (x) { setFormErr(errOf(x)); } finally { setBusy(false); }
  };
  return (
    <Sheet title={goal ? 'Editar meta' : 'Nova meta'} onClose={closeSheet} busy={busy}>
      <form onSubmit={save} noValidate style="display:flex;flex-direction:column;gap:14px">
        <OfflineNote />
        <div role="group" aria-label="Ícone" style="display:flex;gap:8px;flex-wrap:wrap">
          {GOAL_ICONS.map((n) => <button type="button" key={n} class="press ico" aria-label={ICON_LABEL[n]} aria-pressed={icon === n} onClick={() => setIcon(n)} style={icon === n ? 'background:var(--lime);color:var(--black);border-color:var(--lime)' : ''}><Icon n={n} size={20} /></button>)}
        </div>
        <Field id="g-name" label="Nome da meta" error={errs.name}><input id="g-name" class="input" maxLength={60} placeholder="Ex.: Viagem de fim de ano" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-invalid={!!errs.name} /></Field>
        <Field id="g-target" label="Quanto quer juntar (R$)" error={errs.target}><input id="g-target" class="input" inputMode="decimal" placeholder="0,00" value={target} onInput={(e) => setTarget((e.target as HTMLInputElement).value)} aria-invalid={!!errs.target} /></Field>
        <Field id="g-deadline" label="Até quando" error={errs.deadline}><input id="g-deadline" class="input" type="date" min={tomorrow} value={deadline} onInput={(e) => setDeadline((e.target as HTMLInputElement).value)} aria-invalid={!!errs.deadline} /></Field>
        {!goal && <Field id="g-saved" label="Quanto já tem guardado (opcional)" error={errs.saved}><input id="g-saved" class="input" inputMode="decimal" placeholder="0,00" value={saved} onInput={(e) => setSaved((e.target as HTMLInputElement).value)} aria-invalid={!!errs.saved} />
          <span class="muted">Dinheiro que já está guardado fora do app: não altera seu saldo aqui.</span></Field>}
        {prev && <div class="banner" role="status"><Icon n="info" size={18} /><div>Para chegar lá, guarde <b style="color:#fff">{fmtBRL(prev.needPerMonth)}/mês</b> (≈ {fmtBRL(prev.needPerWeek)}/semana). <span class="muted">Cálculo: o que falta ÷ meses até o prazo.</span></div></div>}
        {formErr && <div class="err" role="alert">{formErr}</div>}
        <button class="btn-p press" type="submit" disabled={busy || !online.value}>{busy ? 'Salvando…' : goal ? 'Salvar' : 'Criar meta'}</button>
      </form>
    </Sheet>
  );
}

export function GoalDetail({ id }: { id: string }) {
  const g = snap.value.goals.find((x) => x.id === id);
  const [moves, setMoves] = useState<GoalMove[] | null>(null); const [mErr, setMErr] = useState('');
  useEffect(() => { let on = true; api.goalMoves(id).then((m) => on && setMoves(m)).catch((e) => on && setMErr(errOf(e))); return () => { on = false; }; }, [id, g?.saved]);
  if (!g) { return <Sheet title="Meta" onClose={closeSheet}><p class="muted">Meta não encontrada.</p></Sheet>; }
  const s = goalStats(g, todayS.value);
  const C = 2 * Math.PI * 52;
  const del = () => { sheet.value = { k: 'confirm', title: 'Excluir meta?', body: `“${g.name}” será removida e o valor guardado (${fmtBRL(g.saved)}) volta ao seu saldo disponível.`, label: 'Excluir', danger: true,
    onConfirm: async () => { try { await api.deleteGoal(g.id); await refreshAll(); toast('Meta excluída.'); } catch (e) { toast(errOf(e)); } } }; };
  return (
    <Sheet title={g.name} onClose={closeSheet}>
      <div style="display:flex;align-items:center;gap:20px;margin-bottom:16px">
        <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label={`${s.pct}% da meta`}>
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--s2)" stroke-width="10" />
          <circle class="ringfill" cx="60" cy="60" r="52" fill="none" stroke="var(--lime)" stroke-width="10" stroke-linecap="round" stroke-dasharray={C} stroke-dashoffset={C * (1 - s.pct / 100)} transform="rotate(-90 60 60)" />
          <text x="60" y="68" text-anchor="middle" fill="#fff" font-size="26" font-weight="700" font-family="Poppins">{s.pct}%</text>
        </svg>
        <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
          <span class="tag" style={s.status === 'behind' || s.status === 'late' ? 'border-color:#5a2f29;color:var(--danger)' : s.status === 'start' ? 'border-color:var(--s3);color:var(--gray)' : ''}>{STATUS_LABEL[s.status]}</span>
          <span style="font-size:22px;font-weight:700;letter-spacing:-.02em">{fmtBRL(g.saved)}</span>
          <span class="muted">de {fmtBRL(g.target_amount)} · faltam {fmtBRL(s.remaining)}</span>
          <span class="muted">{s.daysLeft >= 0 ? `${s.daysLeft} dias · até ${shortDate(g.deadline)} ${g.deadline.slice(0, 4)}` : 'Prazo vencido'}</span>
        </div>
      </div>
      {s.remaining > 0 && s.daysLeft >= 0 && <div class="banner" style="margin-bottom:10px"><Icon n="target" size={18} /><div><b style="color:#fff">Calculado:</b> guarde {fmtBRL(s.needPerMonth)}/mês (≈ {fmtBRL(s.needPerWeek)}/semana). <span class="muted">O que falta ÷ meses até o prazo.</span></div></div>}
      {s.eta && <div class="banner" style="margin-bottom:10px"><Icon n="insights" size={18} /><div><b style="color:#fff">Estimativa:</b> conclusão por volta de {shortDate(s.eta)} {s.eta.slice(0, 4)}. <span class="muted">Projeta seu ritmo médio de {fmtBRL(s.pacePerMonth ?? 0)}/mês desde o 1º aporte; muda se o ritmo mudar.</span></div></div>}
      <div style="display:flex;gap:10px;margin:16px 0">
        <button class="btn-p press" style="flex:1" disabled={!online.value || s.remaining === 0} onClick={() => { sheet.value = { k: 'gmove', goalId: g.id, kind: 'deposit' }; }}>Guardar</button>
        <button class="btn-s press" style="flex:1" disabled={!online.value || g.saved <= 0} onClick={() => { sheet.value = { k: 'gmove', goalId: g.id, kind: 'withdraw' }; }}>Retirar</button>
      </div>
      <h3 style="font-size:15px;font-weight:600;margin-bottom:4px">Histórico</h3>
      {mErr ? <p class="err">{mErr}</p> : moves == null ? <p class="muted">Carregando…</p> : moves.length === 0 ? <p class="muted" style="padding:8px 0">Sem movimentações ainda.</p> :
        moves.map((m) => <div class="row" key={m.id} style="min-height:52px"><span style="flex:1"><div style="font-weight:600">{m.kind === 'deposit' ? 'Guardou' : 'Retirou'}</div><div class="muted">{longDate(m.occurred_on)}{!m.counts_in_balance ? ' · valor inicial (fora do app)' : ''}</div></span><b style={{ color: m.kind === 'deposit' ? 'var(--lime)' : '#fff' }}>{m.kind === 'deposit' ? '+' : '−'}{fmtBRL(m.amount)}</b></div>)}
      <div style="display:flex;gap:10px;margin-top:18px">
        <button class="btn-s press" style="flex:1" disabled={!online.value} onClick={() => { sheet.value = { k: 'goalform', goal: g }; }}><Icon n="edit" size={18} />Editar</button>
        <button class="btn-s btn-d press" style="flex:1" disabled={!online.value} onClick={del}><Icon n="trash" size={18} />Excluir</button>
      </div>
    </Sheet>
  );
}

export function GoalMoveSheet({ goalId, kind }: { goalId: string; kind: 'deposit' | 'withdraw' }) {
  const g = snap.value.goals.find((x) => x.id === goalId);
  const [v, setV] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const bal = snap.value.sumMonth?.balance ?? 0;
  if (!g) return null;
  const max = kind === 'deposit' ? Math.min(Math.max(bal, 0), g.target_amount - g.saved) : g.saved;
  const add = (n: number) => setV(String(Math.min(n, max)).replace('.', ','));
  const save = async (e: Event) => {
    e.preventDefault(); if (busy) return;
    const n = parseBRL(v); if (n == null) return setErr('Informe um valor maior que zero.');
    setBusy(true); setErr('');
    try { await api.goalMove(key.current, goalId, kind, n, todayS.value); await refreshAll(); toast(kind === 'deposit' ? `${fmtBRL(n)} guardados em “${g.name}”.` : `${fmtBRL(n)} devolvidos ao seu saldo.`); sheet.value = { k: 'goal', id: goalId }; }
    catch (x) { setErr(errOf(x)); } finally { setBusy(false); }
  };
  return (
    <Sheet title={kind === 'deposit' ? `Guardar em ${g.name}` : `Retirar de ${g.name}`} onClose={() => { sheet.value = { k: 'goal', id: goalId }; }} busy={busy}>
      <form onSubmit={save} noValidate style="display:flex;flex-direction:column;gap:14px">
        <p class="muted">{kind === 'deposit' ? `Saldo disponível: ${fmtBRL(bal)}. O valor guardado sai do seu saldo.` : `Guardado na meta: ${fmtBRL(g.saved)}. O valor retirado volta ao seu saldo.`}</p>
        <Field id="gm" label="Valor (R$)" error={err}><input id="gm" class="input" inputMode="decimal" placeholder="0,00" value={v} onInput={(e) => setV((e.target as HTMLInputElement).value)} aria-invalid={!!err} style="font-size:22px;font-weight:700" /></Field>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          {[50, 100, 200].map((n) => <button type="button" class="btn-s press" key={n} style="min-height:44px" onClick={() => add(n)}>+{n}</button>)}
          <button type="button" class="btn-s press" style="min-height:44px" onClick={() => add(max)}>{kind === 'deposit' ? 'Completar' : 'Tudo'}</button>
        </div>
        <button class="btn-p press" type="submit" disabled={busy || !online.value}>{busy ? 'Salvando…' : kind === 'deposit' ? 'Guardar' : 'Retirar'}</button>
      </form>
    </Sheet>
  );
}
