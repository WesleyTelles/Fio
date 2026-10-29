import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon, Mark, P, type IconName } from './Icon';
import { navigate, route, sheet, toastS, syncUi, pendingCount, online, outbox, type SyncUi } from '../lib/state';

export const iconFor = (name?: string): IconName => ((name && name in P ? name : 'dots') as IconName);

/** Bottom sheet acessível: role=dialog, foco inicial, Esc fecha, devolve o foco ao fechar. */
export function Sheet({ title, children, onClose, busy }: { title: string; children: ComponentChildren; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current!; el.querySelector<HTMLElement>('input,select,button.btn-p,button')?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
      if (e.key === 'Tab') { const f = [...el.querySelectorAll<HTMLElement>('input,select,button,a[href],textarea')].filter((x) => !x.hasAttribute('disabled')); if (!f.length) return;
        const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); prev?.focus?.(); };
  }, []);
  return (
    <div class="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div class="grab" aria-hidden="true" />
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <h2 style="font-size:20px;font-weight:700;letter-spacing:-.02em">{title}</h2>
          <button class="press ibtn" aria-label="Fechar" onClick={onClose} disabled={busy} style="margin-right:-10px"><Icon n="close" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
export const closeSheet = () => { sheet.value = null; };

export function Toast() {
  const t = toastS.value; if (!t) return null;
  return (
    <div class="toast" role="status" aria-live="polite" key={t.id}>
      <span style="flex:1">{t.text}</span>
      {t.action && <button class="press btn-link" style="padding:0 10px" onClick={() => { t.action!.run(); toastS.value = null; }}>{t.action.label}</button>}
    </div>
  );
}

const NAV: Array<[string, string, IconName, string]> = [['/', 'Início', 'home', 'Início'], ['/movimentacoes', 'Movimentações', 'list', 'Movimentações'], ['/orcamento', 'Orçamento', 'wallet', 'Orçamento'], ['/insights', 'Insights', 'insights', 'Insights']];
export function Nav() {
  const r = route.value === '/metas' ? '/orcamento' : route.value;
  return (
    <>
      <button class="fab press" aria-label="Abrir assistente para registrar" onClick={() => navigate('/assistente')}><Mark size={28} color="#10110F" /></button>
      <nav class="nav" aria-label="Navegação principal">
        {NAV.map(([href, label, ic]) => (
          <a href={href} key={href} aria-current={r === href ? 'page' : undefined} aria-label={label} class="press"
            onClick={(e) => { e.preventDefault(); navigate(href); }}><Icon n={ic} size={22} /><span>{label}</span></a>
        ))}
      </nav>
    </>
  );
}

const SYNC: Record<SyncUi, { t: string; c: string; ic?: IconName }> = {
  offline: { t: 'Offline', c: 'neutral', ic: 'cloudOff' }, syncing: { t: 'Sincronizando…', c: 'neutral', ic: 'refresh' },
  pending: { t: 'Pendente', c: 'warn', ic: 'refresh' }, failed: { t: 'Falha ao sincronizar', c: 'warn', ic: 'warn' },
  synced: { t: 'Sincronizado', c: '' }, blocked: { t: 'Sessão expirada', c: 'warn', ic: 'warn' },
};
/** Estado de sincronização: discreto, sempre honesto (nunca "Salvo" com dado só no aparelho). */
export function SyncBadge() {
  const s = syncUi.value, d = SYNC[s], n = pendingCount.value;
  const label = (s === 'pending' || s === 'offline') && n ? `${d.t} · ${n} pendente${n > 1 ? 's' : ''}` : d.t;
  return (
    <button class={`tag press ${d.c}`} style="min-height:44px;height:auto;background:none;border:0;padding:0" aria-label={`Estado de sincronização: ${label}`} onClick={() => { if (n || s === 'failed') sheet.value = { k: 'pending' }; else void outbox.sync(); }}>
      <span class={`tag ${d.c}`}>
        {d.ic ? <Icon n={d.ic} size={13} sw={2.2} class={s === 'syncing' ? 'spin' : ''} /> : <span style="width:7px;height:7px;border-radius:50%;background:currentColor" />}
        {label}
      </span>
    </button>
  );
}

export function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ComponentChildren }) {
  return <div class="field"><label for={id}>{label}</label>{children}{error && <div class="err" id={id + '-e'} role="alert">{error}</div>}</div>;
}

export const Skeleton = ({ h = 14, w = '100%', r = 8 }: { h?: number; w?: string | number; r?: number }) => <div class="sk" style={{ height: h + 'px', width: typeof w === 'number' ? w + 'px' : w, borderRadius: r + 'px' }} />;
export function ListSkeleton({ n = 4 }: { n?: number }) {
  return <div aria-busy="true" aria-label="Carregando">{Array.from({ length: n }, (_, i) => (
    <div key={i} style="display:flex;align-items:center;gap:14px;height:68px;border-bottom:1px solid var(--s1)"><Skeleton h={44} w={44} r={14} /><div style="flex:1;display:flex;flex-direction:column;gap:8px"><Skeleton h={12} w="55%" /><Skeleton h={10} w="35%" /></div><Skeleton h={14} w={64} /></div>))}</div>;
}
export function Empty({ icon = 'wallet', title, text, action }: { icon?: IconName; title: string; text: string; action?: ComponentChildren }) {
  return <div style="padding:36px 8px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px"><span class="ico" style="width:56px;height:56px;border-radius:18px;color:var(--lime)"><Icon n={icon} size={26} /></span><h3 style="font-size:17px;font-weight:600">{title}</h3><p class="muted" style="max-width:300px;font-size:13px">{text}</p>{action}</div>;
}
export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return <div class="banner warn" role="alert"><Icon n="warn" size={18} color="var(--danger)" /><div style="flex:1"><div style="color:#fff;font-size:13px">{text}</div>{onRetry && <button class="btn-link press" onClick={onRetry}>Tentar de novo</button>}</div></div>;
}
export function OfflineNote() {
  return online.value ? null : <div class="banner" role="status"><Icon n="cloudOff" size={18} /><span>Você está offline. Esta ação precisa de conexão.</span></div>;
}
