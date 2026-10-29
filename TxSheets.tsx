import { useRef, useState } from 'preact/hooks';
import { Sheet, closeSheet, Field, OfflineNote } from '../components/ui';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { mapError } from '../lib/errors';
import { catById, catName, createTransaction, expenseCats, incomeCats, myOps, online, outbox, refreshAll, sheet, todayS, toast, type SheetState } from '../lib/state';
import { fmtBRL, parseBRL } from '../../supabase/functions/_shared/money';
import { isISODate, longDate } from '../../supabase/functions/_shared/dates';
import type { Tx, TxType } from '../domain/types';

type TxFormState = Extract<SheetState, { k: 'txform' }>;

export function TxForm(s: TxFormState) {
  const edit = s.mode === 'edit' && s.tx;
  const [type, setType] = useState<TxType>(edit ? s.tx!.type : s.init?.type ?? 'expense');
  const [amount, setAmount] = useState(edit ? String(s.tx!.amount).replace('.', ',') : s.init?.amount ?? '');
  const [desc, setDesc] = useState(edit ? s.tx!.description : s.init?.description ?? '');
  const [cat, setCat] = useState(edit ? s.tx!.category_id : s.init?.category_id ?? '');
  const [date, setDate] = useState(edit ? s.tx!.occurred_on : s.init?.date ?? todayS.value);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const key = useRef(crypto.randomUUID());     // 1 chave por formulário: duplo clique/reenvio nunca duplica
  const list = (type === 'expense' ? expenseCats.value : incomeCats.value).slice();
  if (edit && s.tx!.type === type && !list.some((c) => c.id === s.tx!.category_id)) { const c = catById(s.tx!.category_id); if (c) list.push(c); }
  const pickType = (t: TxType) => { setType(t); if (cat && catById(cat)?.kind !== t) setCat(''); };

  const validate = () => {
    const e: Record<string, string> = {};
    const v = parseBRL(amount); if (v == null) e.amount = 'Informe um valor maior que zero, ex.: 42,50.';
    if (!desc.trim()) e.desc = 'Informe uma descrição.'; else if (desc.trim().length > 120) e.desc = 'Use até 120 caracteres.';
    if (!cat || !list.some((c) => c.id === cat)) e.cat = 'Escolha uma categoria.';
    if (!isISODate(date) || date > todayS.value) e.date = 'Escolha uma data até hoje.';
    setErrs(e); return Object.keys(e).length ? null : v!;
  };
  const submit = async (ev: Event) => {
    ev.preventDefault(); if (busy) return; setFormErr('');
    const v = validate(); if (v == null) return;
    setBusy(true);
    try {
      if (edit) {
        if (!online.value) { setFormErr('Editar precisa de conexão. Tente quando estiver online.'); return; }
        await api.updateTx(s.tx!.id, { type, amount: v, description: desc.trim(), category_id: cat, occurred_on: date }, s.tx!.updated_at);
        await refreshAll(); toast('Lançamento atualizado.'); s.onDone?.({ synced: true }); closeSheet();
      } else {
        const r = await createTransaction({ type, amount: v, description: desc.trim(), category_id: cat, occurred_on: date, source: s.source ?? 'manual', ai_meta: s.aiMeta ?? null }, key.current);
        if (r.rejected) { setFormErr(r.rejected.message); return; }
        toast(r.synced ? 'Lançamento registrado.' : 'Guardado neste aparelho — pendente de sincronização.');
        s.onDone?.({ synced: r.synced }); closeSheet();
      }
    } catch (e) {
      const m = mapError(e); setFormErr(m.message);
      if (m.kind === 'conflict') void refreshAll();
    } finally { setBusy(false); }
  };

  return (
    <Sheet title={edit ? 'Editar lançamento' : s.mode === 'draft' ? 'Revisar lançamento' : 'Novo lançamento'} onClose={closeSheet} busy={busy}>
      <form onSubmit={submit} noValidate style="display:flex;flex-direction:column;gap:14px">
        {edit && <OfflineNote />}
        <div class="seg" role="group" aria-label="Tipo">
          <button type="button" aria-pressed={type === 'expense'} onClick={() => pickType('expense')}>Despesa</button>
          <button type="button" aria-pressed={type === 'income'} onClick={() => pickType('income')}>Receita</button>
        </div>
        <Field id="f-amount" label="Valor (R$)" error={errs.amount}>
          <input id="f-amount" class="input" inputMode="decimal" autocomplete="off" placeholder="0,00" value={amount} aria-invalid={!!errs.amount} aria-describedby={errs.amount ? 'f-amount-e' : undefined}
            onInput={(e) => setAmount((e.target as HTMLInputElement).value)} style="font-size:22px;font-weight:700" />
        </Field>
        <Field id="f-desc" label="Descrição" error={errs.desc}>
          <input id="f-desc" class="input" maxLength={120} autocomplete="off" placeholder={type === 'expense' ? 'Ex.: almoço, Uber' : 'Ex.: salário, freela'} value={desc} aria-invalid={!!errs.desc}
            onInput={(e) => setDesc((e.target as HTMLInputElement).value)} />
        </Field>
        <Field id="f-cat" label={s.mode === 'draft' && s.init?.category_id ? 'Categoria (sugerida — você pode trocar)' : 'Categoria'} error={errs.cat}>
          <select id="f-cat" class="input" value={cat} aria-invalid={!!errs.cat} onChange={(e) => setCat((e.target as HTMLSelectElement).value)}>
            <option value="">Selecione…</option>
            {list.map((c) => <option key={c.id} value={c.id}>{c.name}{c.archived_at ? ' (arquivada)' : ''}</option>)}
          </select>
        </Field>
        <Field id="f-date" label="Data" error={errs.date}>
          <input id="f-date" class="input" type="date" max={todayS.value} value={date} aria-invalid={!!errs.date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        </Field>
        {formErr && <div class="err" role="alert">{formErr}</div>}
        <button class="btn-p press" type="submit" disabled={busy}>{busy ? 'Salvando…' : edit ? 'Salvar alterações' : s.mode === 'draft' ? 'Confirmar e registrar' : 'Registrar'}</button>
        {!edit && !online.value && <p class="muted" style="text-align:center">Sem conexão: o lançamento ficará guardado aqui como <b>pendente</b> até sincronizar.</p>}
      </form>
    </Sheet>
  );
}

export function TxDetail({ tx }: { tx: Tx }) {
  const [busy, setBusy] = useState(false);
  const c = catById(tx.category_id);
  const del = async () => {
    setBusy(true);
    try {
      if (tx.pending) { await outbox.discard(tx.id); closeSheet(); toast('Pendência descartada.'); return; }
      await api.deleteTx(tx.id); closeSheet(); await refreshAll();
      toast('Lançamento excluído.', { label: 'Desfazer', run: async () => { try { await api.restoreTx(tx.id); await refreshAll(); toast('Lançamento restaurado.'); } catch (e) { toast(mapError(e).message); } } });
    } catch (e) { toast(mapError(e).message); } finally { setBusy(false); }
  };
  const ask = () => { sheet.value = { k: 'confirm', title: tx.pending ? 'Descartar pendência?' : 'Excluir lançamento?', body: tx.pending ? 'Ele ainda não foi enviado ao servidor e será apagado deste aparelho.' : `“${tx.description}” (${fmtBRL(tx.amount)}) sai do histórico, do saldo e do orçamento. Você poderá desfazer por alguns segundos.`, label: tx.pending ? 'Descartar' : 'Excluir', danger: true, onConfirm: del }; };
  return (
    <Sheet title="Lançamento" onClose={closeSheet} busy={busy}>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:18px">
        <span class="muted">{tx.type === 'income' ? 'Receita' : 'Despesa'} · {c?.name ?? 'Outros'}</span>
        <span style={{ fontSize: '34px', fontWeight: 700, letterSpacing: '-.03em', color: tx.type === 'income' ? 'var(--lime)' : '#fff' }}>{tx.type === 'income' ? '+' : '−'}{fmtBRL(tx.amount)}</span>
        <span style="font-size:16px;font-weight:600">{tx.description}</span>
      </div>
      <dl style="margin:0 0 18px;display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:13px">
        <dt class="muted">Data</dt><dd style="margin:0;text-align:right">{longDate(tx.occurred_on)}</dd>
        <dt class="muted">Origem</dt><dd style="margin:0;text-align:right">{tx.source === 'ai' ? 'Assistente (confirmado por você)' : 'Manual'}</dd>
        <dt class="muted">Situação</dt><dd style="margin:0;text-align:right">{tx.pending ? 'Pendente de sincronização' : 'Sincronizado'}</dd>
      </dl>
      <div style="display:flex;gap:10px">
        {!tx.pending && <button class="btn-s press" style="flex:1" disabled={busy || !online.value} onClick={() => { sheet.value = { k: 'txform', mode: 'edit', tx }; }}><Icon n="edit" size={18} />Editar</button>}
        <button class="btn-s btn-d press" style="flex:1" disabled={busy || (!tx.pending && !online.value)} onClick={ask}><Icon n="trash" size={18} />{tx.pending ? 'Descartar' : 'Excluir'}</button>
      </div>
      {!tx.pending && !online.value && <p class="muted" style="margin-top:10px;text-align:center">Editar e excluir precisam de conexão.</p>}
    </Sheet>
  );
}

export function ConfirmSheet(s: Extract<SheetState, { k: 'confirm' }>) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={s.title} onClose={closeSheet} busy={busy}>
      <p style="color:var(--gray);margin-bottom:20px;line-height:1.5">{s.body}</p>
      <div style="display:flex;gap:10px">
        <button class="btn-s press" style="flex:1" onClick={closeSheet} disabled={busy}>Cancelar</button>
        <button class={`btn-s press ${s.danger ? 'btn-d' : ''}`} style="flex:1" disabled={busy} onClick={async () => { setBusy(true); try { closeSheet(); await s.onConfirm(); } finally { setBusy(false); } }}>{s.label}</button>
      </div>
    </Sheet>
  );
}

export function PendingSheet() {
  return (
    <Sheet title="Sincronização" onClose={closeSheet}>
      {myOps.value.length === 0 ? <p class="muted" style="padding:8px 0 16px">Tudo sincronizado. Nenhum lançamento pendente neste aparelho.</p> : (
        <div style="margin-bottom:12px">
          <p class="muted" style="margin-bottom:8px">Estes lançamentos estão <b>só neste aparelho</b> e ainda não foram confirmados pelo servidor.</p>
          {myOps.value.map((o) => (
            <div class="row" key={o.id} style="min-height:72px">
              <span class="ico"><Icon n="refresh" size={18} /></span>
              <span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{o.payload.description}</span>
                <span class="muted">{catName(o.payload.category_id)} · {o.status === 'rejected' ? `Recusado: ${o.error ?? ''}` : o.status === 'failed' ? `Falhou: ${o.error ?? 'rede'}` : o.status === 'syncing' ? 'Enviando…' : 'Aguardando envio'}</span></span>
              <span style="font-weight:700">{o.payload.type === 'income' ? '+' : '−'}{fmtBRL(o.payload.amount)}</span>
              <span style="display:flex;flex-direction:column">
                {o.status !== 'rejected' && <button class="btn-link press" onClick={() => void outbox.retry(o.id)}>Enviar</button>}
                <button class="btn-link press" style="color:var(--danger)" onClick={() => void outbox.discard(o.id)}>Descartar</button>
              </span>
            </div>
          ))}
          <button class="btn-p press" style="margin-top:14px" disabled={!online.value} onClick={() => void outbox.sync()}>{online.value ? 'Tentar sincronizar agora' : 'Sem conexão'}</button>
        </div>
      )}
    </Sheet>
  );
}
