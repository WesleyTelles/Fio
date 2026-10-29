import { signal } from '@preact/signals';
import { registerSW } from 'virtual:pwa-register';
import { outbox, pendingCount } from './state';

export const needRefresh = signal(false);
export const offlineReady = signal(false);
export const installEvent = signal<(Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null>(null);

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
export const platform = {
  isIOS: /iphone|ipad|ipod/i.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  isAndroid: /android/i.test(ua),
  isSafari: /safari/i.test(ua) && !/crios|fxios|edgios|chrome|android/i.test(ua),
  standalone: () => (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) || (navigator as any).standalone === true,
};
export const installed = signal(typeof window !== 'undefined' && platform.standalone());

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
export function initPWA() {
  updateSW = registerSW({
    onNeedRefresh() { needRefresh.value = true; },
    onOfflineReady() { offlineReady.value = true; },
    onRegisteredSW(_url, reg) { if (reg) setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000); },
  });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent.value = e as any; });
  window.addEventListener('appinstalled', () => { installed.value = true; installEvent.value = null; });
  matchMedia('(display-mode: standalone)').addEventListener?.('change', () => { installed.value = platform.standalone(); });
}
/** Só atualiza com a fila vazia e sem envio em andamento: nunca no meio de um lançamento financeiro pendente. */
export function canUpdateNow() { return pendingCount.value === 0 && !outbox.running.value; }
export async function applyUpdate() { if (!canUpdateNow() || !updateSW) return false; await updateSW(true); return true; }
export async function promptInstall() {
  const e = installEvent.value; if (!e) return;
  await e.prompt(); await e.userChoice.catch(() => {}); installEvent.value = null;
}
