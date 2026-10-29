// Fila de sincronização (offline-first proporcional): SÓ criação de lançamentos é aceita offline.
// Edição/exclusão/orçamento/metas exigem conexão (evita conflitos que não dá para resolver com segurança).
//
// Garantias:
//  - A operação é gravada no IndexedDB ANTES de qualquer envio (sobrevive a fechar a aba).
//  - id da operação == chave de idempotência enviada ao servidor: reenvio nunca duplica.
//  - Só envia com o MESMO usuário que criou a operação; outra conta nunca recebe pendências alheias.
//  - Só some da fila depois de resposta válida do servidor (ou rejeição explícita da regra de negócio).
import { signal } from '@preact/signals';
import { opsDb } from './idb';
import { AppError } from './errors';
import type { PendingOp, TxPayload } from '../domain/types';

export interface OutboxApi { createTx(key: string, p: TxPayload): Promise<{ duplicate: boolean }> }
export interface OutboxDeps {
  api: OutboxApi;
  userId: () => string | null;
  refreshSession: () => Promise<boolean>;
  online: () => boolean;
  onSynced?: () => void;
  uuid?: () => string;
  now?: () => Date;
}

export class Outbox {
  ops = signal<PendingOp[]>([]);
  running = signal(false);
  /** sessão inválida: operações continuam guardadas, mas nada é enviado até entrar de novo */
  authBlocked = signal(false);
  lastError = signal<string | null>(null);
  private inflight: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private d: OutboxDeps) {}

  async load() {
    const all = await opsDb.all<PendingOp>();
    // "syncing" que sobrou de um fechamento no meio do envio volta a "pending" (o servidor deduplica pela chave)
    for (const o of all) if (o.status === 'syncing') { o.status = 'pending'; await opsDb.put(o); }
    this.ops.value = all.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  mine(): PendingOp[] { const u = this.d.userId(); return u ? this.ops.value.filter((o) => o.user_id === u) : []; }
  others(): PendingOp[] { const u = this.d.userId(); return this.ops.value.filter((o) => o.user_id !== u); }
  pendingCount() { return this.mine().filter((o) => o.status !== 'rejected').length; }

  private async save(o: PendingOp) { await opsDb.put(o); this.ops.value = this.ops.value.map((x) => (x.id === o.id ? o : x)); }
  private async remove(id: string) { await opsDb.del(id); this.ops.value = this.ops.value.filter((x) => x.id !== id); }

  /** Grava na fila (persistente) e devolve a operação. `key` estável por formulário => clique duplo não duplica. */
  async enqueue(payload: TxPayload, key = (this.d.uuid ?? (() => crypto.randomUUID()))()): Promise<PendingOp> {
    const user = this.d.userId();
    if (!user) throw new AppError('auth', 'auth', 'Entre na sua conta para registrar.');
    const existing = this.ops.value.find((o) => o.id === key);
    if (existing) return existing;
    const op: PendingOp = { id: key, user_id: user, kind: 'create_tx', payload, created_at: (this.d.now?.() ?? new Date()).toISOString(), status: 'pending', attempts: 0 };
    await opsDb.put(op);
    this.ops.value = [...this.ops.value, op];
    return op;
  }

  /** Tenta enviar TUDO que é do usuário atual, em ordem. Chamadas concorrentes são coalescidas. */
  sync(): Promise<void> {
    if (this.inflight) { this.again = true; return this.inflight; }
    this.inflight = (async () => {
      this.running.value = true;
      try { do { this.again = false; await this.pass(); } while (this.again); }
      finally { this.running.value = false; this.inflight = null; }
    })();
    return this.inflight;
  }

  private schedule(attempts: number) {
    if (this.timer) clearTimeout(this.timer);
    const ms = Math.min(60000, 2000 * 2 ** Math.min(attempts, 5));
    this.timer = setTimeout(() => { this.timer = null; if (this.d.online()) void this.sync(); }, ms);
  }

  private async pass() {
    const user = this.d.userId();
    if (!user || !this.d.online()) return;
    const queue = this.ops.value.filter((o) => o.user_id === user && o.status !== 'rejected');
    let synced = 0;
    for (const op of queue) {
      if (this.d.userId() !== user) break; // conta mudou no meio: para imediatamente
      await this.save({ ...op, status: 'syncing', attempts: op.attempts + 1 });
      try {
        await this.d.api.createTx(op.id, op.payload); // duplicate:true também significa "já está salvo"
        await this.remove(op.id); synced++; this.lastError.value = null; this.authBlocked.value = false;
      } catch (e) {
        const err = e instanceof AppError ? e : new AppError('server', 'server', 'Erro inesperado.');
        if (err.kind === 'network' || err.kind === 'server' || err.kind === 'rate') {
          await this.save({ ...op, status: 'failed', attempts: op.attempts + 1, error: err.message });
          this.lastError.value = err.message; this.schedule(op.attempts + 1); break;           // preserva a ordem, tenta depois
        }
        if (err.kind === 'auth') {
          await this.save({ ...op, status: 'pending', attempts: op.attempts + 1, error: undefined });
          const ok = await this.d.refreshSession().catch(() => false);
          if (!ok) { this.authBlocked.value = true; this.lastError.value = err.message; break; }
          this.again = true; break; // sessão renovada: nova passada
        }
        // regra de negócio rejeitou: não adianta reenviar igual; fica visível para o usuário decidir
        await this.save({ ...op, status: 'rejected', attempts: op.attempts + 1, error: err.message });
      }
    }
    if (synced) this.d.onSynced?.();
  }

  /** Reabre uma operação 'failed'/'rejected' para nova tentativa manual. */
  async retry(id: string) {
    const o = this.ops.value.find((x) => x.id === id); if (!o) return;
    await this.save({ ...o, status: 'pending', error: undefined });
    await this.sync();
  }
  async discard(id: string) { await this.remove(id); }
  async discardOthers() { for (const o of this.others()) await this.remove(o.id); }
  async purgeUser(userId: string) { for (const o of this.ops.value.filter((x) => x.user_id === userId)) await this.remove(o.id); }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
