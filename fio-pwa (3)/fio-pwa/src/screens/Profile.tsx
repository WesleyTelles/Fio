import { useState } from 'preact/hooks';
import { Icon } from '../components/Icon';
import { Field } from '../components/ui';
import { api } from '../lib/api';
import { auth } from '../lib/auth';
import { config } from '../config';
import { kv } from '../lib/idb';
import { mapError } from '../lib/errors';
import { installEvent, installed, platform, promptInstall, needRefresh, applyUpdate, canUpdateNow } from '../lib/pwa';
import { categories, fromCache, navigate, online, otherOpsCount, outbox, pendingCount, profile, refreshAll, session, sheet, toast } from '../lib/state';
import { fmtBRL, parseBRL } from '../../supabase/functions/_shared/money';

const TZ_COMMON = ['America/Sao_Paulo', 'America/Manaus', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Cuiaba', 'America/Campo_Grande', 'America/Rio_Branco', 'America/Noronha', 'America/Lisbon', 'Europe/Lisbon', 'UTC'];

export function Profile() {
  const p = profile.value; const uidv = session.value.userId!;
  const [name, setName] = useState(p?.display_name ?? ''); const [tz, setTz] = useState(p?.timezone ?? 'America/Sao_Paulo');
  const [open, setOpen] = useState(p ? String(p.opening_balance).replace('.', ',') : '0'); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [cname, setCname] = useState(''); const [ckind, setCkind] = useState<'expense' | 'income'>('expense'); const [cerr, setCerr] = useState('');
  const [del, setDel] = useState(''); const [derr, setDerr] = useState('');
  const custom = categories.value.filter((c) => c.user_id && !c.archived_at);
  const tzs = TZ_COMMON.includes(tz) ? TZ_COMMON : [tz, ...TZ_COMMON];

  const saveProfile = async (e: Event) => {
    e.preventDefault(); setErr('');
    const ob = open.trim() === '' ? 0 : open.trim().startsWith('-') ? -(parseBRL(open.trim().slice(1)) ?? NaN) : parseBRL(open);
    if (!name.trim()) return setErr('Informe seu nome.'); if (ob == null || Number.isNaN(ob)) return setErr('Saldo inicial inválido.');
    setBusy(true);
    try { await api.updateProfile({ display_name: name.trim(), timezone: tz, opening_balance: ob }, uidv); await refreshAll(); toast('Perfil salvo.'); } catch (x) { setErr(mapError(x).message); } finally { setBusy(false); }
  };
  const addCat = async (e: Event) => {
    e.preventDefault(); setCerr(''); if (!cname.trim()) return setCerr('Dê um nome para a categoria.');
    try { await api.createCategory(uidv, cname.trim(), ckind); setCname(''); await refreshAll(); toast('Categoria criada.'); } catch (x) { const m = mapError(x); setCerr(m.code === 'duplicate' ? 'Você já tem uma categoria com esse nome.' : m.message); }
  };
  const archive = (id: string, n: string) => { sheet.value = { k: 'confirm', title: 'Arquivar categoria?', body: `“${n}” deixa de aparecer para novos lançamentos. Lançamentos antigos continuam com ela, e o histórico não muda.`, label: 'Arquivar', onConfirm: async () => { try { await api.archiveCategory(id); await refreshAll(); toast('Categoria arquivada.'); } catch (x) { toast(mapError(x).message); } } }; };
  const exportData = async () => {
    try { const d = await api.exportData(); const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fio-dados-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('Exportação gerada.'); } catch (x) { toast(mapError(x).message); }
  };
  const logout = () => {
    const n = pendingCount.value;
    if (n > 0) sheet.value = { k: 'confirm', title: 'Sair com pendências?', body: `Você tem ${n} lançamento${n > 1 ? 's' : ''} que ainda não ${n > 1 ? 'foram enviados' : 'foi enviado'} ao servidor. Sair agora apaga ${n > 1 ? 'esses lançamentos' : 'esse lançamento'} deste aparelho. Prefere sincronizar antes?`, label: 'Sair e apagar', danger: true, onConfirm: () => auth.signOut(true) };
    else void auth.signOut(false);
  };
  const deleteAccount = async (e: Event) => {
    e.preventDefault(); setDerr('');
    if (del.trim().toUpperCase() !== 'EXCLUIR') return setDerr('Digite EXCLUIR para confirmar.');
    if (!online.value) return setDerr('Precisa de conexão.');
    try { await auth.deleteAccount(); } catch (x) { setDerr(mapError(x).message); }
  };

  return (
    <main class="screen nonav">
      <div style="display:flex;align-items:center;gap:8px"><button class="press ibtn" onClick={() => navigate('/')} aria-label="Voltar" style="margin-left:-10px"><Icon n="back" size={22} sw={2} /></button><h1 class="h1" style="margin:0">Perfil</h1></div>
      <p class="muted" style="margin:6px 0 18px">{session.value.email}</p>

      <section aria-label="Dados pessoais"><form class="card" onSubmit={saveProfile} noValidate style="display:flex;flex-direction:column;gap:14px">
        <Field id="p-name" label="Nome"><input id="p-name" class="input" maxLength={60} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
        <Field id="p-tz" label="Fuso horário (define o “hoje” e o fechamento do mês)"><select id="p-tz" class="input" value={tz} onChange={(e) => setTz((e.target as HTMLSelectElement).value)}>{tzs.map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}</select></Field>
        <Field id="p-open" label="Saldo inicial (R$)"><input id="p-open" class="input" inputMode="decimal" value={open} onInput={(e) => setOpen((e.target as HTMLInputElement).value)} /><span class="muted">Quanto você tinha antes do primeiro lançamento. Soma ao saldo calculado dos lançamentos.</span></Field>
        {err && <div class="err" role="alert">{err}</div>}
        <button class="btn-p press" disabled={busy || !online.value}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </form></section>

      <section style="margin-top:26px" aria-label="Instalar aplicativo"><h2 style="font-size:18px;font-weight:600;margin-bottom:10px">Instalar no celular</h2>
        <div class="card">{installed.value ? <p><Icon n="check" size={18} color="var(--lime)" /> Fio já está instalado e aberto como aplicativo.</p> :
          installEvent.value ? <><p class="muted" style="margin-bottom:12px">Adicione o Fio à tela inicial e abra como um app, em tela cheia.</p><button class="btn-p press" onClick={() => void promptInstall()}><Icon n="download" size={20} />Instalar aplicativo</button></> :
          platform.isIOS && platform.isSafari ? <ol style="margin:0;padding-left:20px;line-height:1.8"><li>Toque em <b>Compartilhar</b> <Icon n="share" size={16} /> na barra do Safari.</li><li>Escolha <b>Adicionar à Tela de Início</b>.</li><li>Toque em <b>Adicionar</b>. O Fio abre como app.</li></ol> :
          platform.isIOS ? <p>No iPhone a instalação só é possível pelo <b>Safari</b>. Abra este endereço no Safari e use Compartilhar → Adicionar à Tela de Início.</p> :
          platform.isAndroid ? <p>No Android, abra o menu <b>⋮</b> do Chrome e toque em <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).</p> :
          <p class="muted">Se o seu navegador permitir, use o ícone de instalação na barra de endereço.</p>}</div></section>

      <section style="margin-top:26px" aria-label="Categorias"><h2 style="font-size:18px;font-weight:600;margin-bottom:10px">Suas categorias</h2>
        <div class="card"><p class="muted" style="margin-bottom:10px">As categorias padrão já estão disponíveis. Crie as suas:</p>
          {custom.map((c) => <div class="row" key={c.id} style="min-height:52px"><span style="flex:1">{c.name}<span class="muted"> · {c.kind === 'income' ? 'receita' : 'despesa'}</span></span><button class="btn-link press" style="color:var(--danger)" onClick={() => archive(c.id, c.name)}>Arquivar</button></div>)}
          <form onSubmit={addCat} noValidate style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
            <div class="seg" role="group" aria-label="Tipo da categoria"><button type="button" aria-pressed={ckind === 'expense'} onClick={() => setCkind('expense')}>Despesa</button><button type="button" aria-pressed={ckind === 'income'} onClick={() => setCkind('income')}>Receita</button></div>
            <Field id="c-name" label="Nome da categoria" error={cerr}><input id="c-name" class="input" maxLength={40} value={cname} onInput={(e) => setCname((e.target as HTMLInputElement).value)} /></Field>
            <button class="btn-s press" disabled={!online.value}><Icon n="plus" size={18} />Criar categoria</button></form></div></section>

      <section style="margin-top:26px" aria-label="Sincronização e dados"><h2 style="font-size:18px;font-weight:600;margin-bottom:10px">Dados e sincronização</h2>
        <div class="card" style="display:flex;flex-direction:column;gap:10px">
          <button class="btn-s press" onClick={() => { sheet.value = { k: 'pending' }; }}><Icon n="refresh" size={18} />{pendingCount.value ? `${pendingCount.value} pendente(s) neste aparelho` : 'Ver estado da sincronização'}</button>
          {otherOpsCount.value > 0 && <div class="banner warn"><Icon n="warn" size={18} color="var(--danger)" /><div><div style="color:#fff">Há {otherOpsCount.value} pendência(s) de outra conta neste aparelho. Elas não serão enviadas para esta conta.</div><button class="btn-link press" style="color:var(--danger)" onClick={() => void outbox.discardOthers().then(() => toast('Pendências de outra conta descartadas.'))}>Descartar</button></div></div>}
          <button class="btn-s press" disabled={!online.value} onClick={exportData}><Icon n="download" size={18} />Exportar meus dados (JSON)</button>
          <button class="btn-s press" onClick={async () => { await kv.del('snap:' + uidv).catch(() => {}); toast('Cache de leitura limpo. Pendências foram mantidas.'); }}>Limpar cache local</button>
          <p class="muted">O cache local é só uma cópia de leitura para abrir sem internet. A fonte dos seus dados é o servidor.{fromCache.value ? ' Você está vendo dados do cache.' : ''}</p></div></section>

      <section style="margin-top:26px" aria-label="Aplicativo"><div class="card" style="display:flex;flex-direction:column;gap:10px">
        <div class="muted">Fio · versão {config.buildId} · valores em BRL (R$)</div>
        {needRefresh.value && <button class="btn-s press" disabled={!canUpdateNow()} onClick={() => void applyUpdate()}>{canUpdateNow() ? 'Atualizar para a nova versão' : 'Atualizar (aguarde sincronizar pendências)'}</button>}
        <button class="btn-s press" onClick={logout}><Icon n="logout" size={18} />Sair</button></div></section>

      <section style="margin-top:26px" aria-label="Excluir conta"><h2 style="font-size:18px;font-weight:600;margin-bottom:10px">Excluir conta</h2>
        <form class="card" onSubmit={deleteAccount} noValidate style="display:flex;flex-direction:column;gap:10px">
          <p class="muted">Apaga definitivamente sua conta e todos os seus dados (lançamentos, orçamentos, metas). Não dá para desfazer. Exporte antes se quiser guardar uma cópia.</p>
          <Field id="d-c" label="Digite EXCLUIR para confirmar" error={derr}><input id="d-c" class="input" value={del} autocomplete="off" onInput={(e) => setDel((e.target as HTMLInputElement).value)} /></Field>
          <button class="btn-s btn-d press" disabled={!online.value}>Excluir minha conta</button></form></section>
    </main>
  );
}
