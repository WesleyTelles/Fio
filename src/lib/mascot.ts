// Estado da mascote da assistente. NÃO contém regra financeira: só REAGE a eventos reais já existentes
// (processamento da IA, resultado de createTransaction, erro do provedor). Nada aqui grava, confirma ou calcula dinheiro.
//
// Hierarquia (do mais forte ao mais fraco): oops > happy > busy > idle.
//  - oops  : o salvamento foi RECUSADO ou a IA falhou (visual neutro, sem culpa).
//  - happy : o servidor CONFIRMOU a gravação (nunca por "pendente offline", nunca por proposta, nunca por cancelamento).
//  - busy  : há trabalho real em andamento (chamada da IA / gravação). Contador: operações paralelas não se atropelam.
//  - idle  : repouso (animação sutil, ou estática em modo "quiet"/movimento reduzido).
import { signal, computed } from '@preact/signals';

export type MascotMood = 'idle' | 'busy' | 'happy' | 'oops';
export type Flash = { kind: 'happy' | 'oops'; id: number } | null;

export const FLASH_MS = { happy: 1600, oops: 2600 } as const;

export const mascotBusy = signal(0);
export const mascotFlash = signal<Flash>(null);

export function resolveMood(busy: number, flash: Flash): MascotMood {
  if (flash?.kind === 'oops') return 'oops';
  if (flash?.kind === 'happy') return 'happy';
  if (busy > 0) return 'busy';
  return 'idle';
}
export const mascotMood = computed<MascotMood>(() => resolveMood(mascotBusy.value, mascotFlash.value));

/** Marca início de trabalho real; devolve a função que encerra (idempotente, para uso em `finally`). */
export function beginBusy(): () => void {
  let done = false;
  mascotBusy.value += 1;
  return () => { if (done) return; done = true; mascotBusy.value = Math.max(0, mascotBusy.value - 1); };
}

let flashTimer: ReturnType<typeof setTimeout> | null = null;
let flashSeq = 0;
/** Reação curta. Uma nova reação substitui a anterior (nunca empilha). */
export function flashMascot(kind: 'happy' | 'oops') {
  if (flashTimer) clearTimeout(flashTimer);
  const id = ++flashSeq;
  mascotFlash.value = { kind, id };
  flashTimer = setTimeout(() => { if (mascotFlash.value?.id === id) mascotFlash.value = null; flashTimer = null; }, FLASH_MS[kind]);
}
export function resetMascot() {
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = null; mascotFlash.value = null; mascotBusy.value = 0;
}

/** Ambiente: pausa animações com a aba oculta e desliga o movimento de repouso em aparelhos modestos. */
export function initMascotEnv(doc: Document = document, nav: Navigator = navigator) {
  const root = doc.documentElement;
  const mem = (nav as any).deviceMemory as number | undefined, cores = nav.hardwareConcurrency;
  if ((mem != null && mem <= 2) || (cores != null && cores <= 2)) root.setAttribute('data-lite', '');
  const sync = () => { if (doc.visibilityState === 'hidden') root.setAttribute('data-hidden', ''); else root.removeAttribute('data-hidden'); };
  doc.addEventListener('visibilitychange', sync); sync();
}
