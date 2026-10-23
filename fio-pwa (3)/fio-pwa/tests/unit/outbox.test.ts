import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Outbox, type OutboxApi } from '../../src/lib/outbox.ts';
import { AppError } from '../../src/lib/errors.ts';
import { resetIdbConnectionForTests } from '../../src/lib/idb.ts';
import type { TxPayload } from '../../src/domain/types.ts';

const P = (o: Partial<TxPayload> = {}): TxPayload => ({ type: 'expense', amount: 8, description: 'Coxinha', category_id: 'alim', occurred_on: '2026-10-21', source: 'manual', ...o });

/** "Servidor" fake com idempotência por chave, igual ao create_transaction do banco. */
function server() {
  const rows = new Map<string, TxPayload>(); const calls: string[] = [];
  let failNext: AppError | null = null; let loseResponse = false;
  const api: OutboxApi = {
    async createTx(key, p) {
      calls.push(key);
      if (failNext) { const e = failNext; failNext = null; throw e; }
      const dup = rows.has(key); if (!dup) rows.set(key, p);
      if (loseResponse) { loseResponse = false; throw new AppError('network', 'network', 'x'); } // gravou mas a resposta se perdeu
      return { duplicate: dup };
    },
  };
  return { api, rows, calls, failWith: (e: AppError) => { failNext = e; }, loseNextResponse: () => { loseResponse = true; } };
}

let user: string | null; let online: boolean; let refresh: () => Promise<boolean>;
const mk = (s = server()) => ({ s, ob: new Outbox({ api: s.api, userId: () => user, online: () => online, refreshSession: () => refresh(), uuid: () => crypto.randomUUID() }) });

beforeEach(() => { (globalThis as any).indexedDB = new IDBFactory(); resetIdbConnectionForTests(); user = 'A'; online = true; refresh = async () => false; vi.useRealTimers(); });

describe('fila de sincronização', () => {
  it('grava no IndexedDB antes de enviar e sobrevive a "fechar o app"', async () => {
    const { ob } = mk(); const op = await ob.enqueue(P());
    expect(op.status).toBe('pending');
    const fresh = mk().ob; await fresh.load();
    expect(fresh.mine()).toHaveLength(1); expect(fresh.mine()[0].id).toBe(op.id);
  });
  it('envia com a chave de idempotência = id e remove só após sucesso', async () => {
    const { ob, s } = mk(); const op = await ob.enqueue(P()); await ob.sync();
    expect(s.calls).toEqual([op.id]); expect(s.rows.size).toBe(1); expect(ob.mine()).toHaveLength(0);
    const fresh = mk().ob; await fresh.load(); expect(fresh.ops.value).toHaveLength(0);
  });
  it('clique duplo (mesma chave) gera uma única operação', async () => {
    const { ob, s } = mk(); const k = crypto.randomUUID();
    await Promise.all([ob.enqueue(P(), k), ob.enqueue(P(), k)]); await ob.sync();
    expect(s.rows.size).toBe(1);
  });
  it('syncs concorrentes são coalescidos (sem envios em paralelo)', async () => {
    const { ob, s } = mk(); await ob.enqueue(P()); await Promise.all([ob.sync(), ob.sync(), ob.sync()]);
    expect(s.rows.size).toBe(1); expect(s.calls.length).toBe(1);
  });
  it('resposta perdida depois do servidor gravar: reenvio NÃO duplica', async () => {
    const { ob, s } = mk(); await ob.enqueue(P()); s.loseNextResponse();
    await ob.sync(); expect(s.rows.size).toBe(1); expect(ob.mine()).toHaveLength(1); expect(ob.mine()[0].status).toBe('failed');
    await ob.retry(ob.mine()[0].id);
    expect(s.rows.size).toBe(1); expect(s.calls.length).toBe(2); expect(ob.mine()).toHaveLength(0); ob.stop();
  });
  it('falha de rede mantém a operação e preserva a ordem', async () => {
    const { ob, s } = mk(); const a = await ob.enqueue(P({ description: 'A' })); await ob.enqueue(P({ description: 'B' }));
    s.failWith(new AppError('network', 'network', 'x')); await ob.sync();
    expect(s.calls).toEqual([a.id]); expect(ob.mine().map((o) => o.status)).toEqual(['failed', 'pending']);
    await ob.sync(); expect(s.rows.size).toBe(2); expect(ob.mine()).toHaveLength(0); ob.stop();
  });
  it('rejeição de regra de negócio não é reenviada e não trava as demais', async () => {
    const { ob, s } = mk(); const a = await ob.enqueue(P({ description: 'A' })); await ob.enqueue(P({ description: 'B' }));
    s.failWith(new AppError('validation', 'validation:category', 'Categoria inválida')); await ob.sync();
    expect(ob.mine().find((o) => o.id === a.id)!.status).toBe('rejected'); expect(s.rows.size).toBe(1);
    await ob.sync(); expect(s.calls.filter((c) => c === a.id)).toHaveLength(1); expect(ob.pendingCount()).toBe(0);
    await ob.discard(a.id); expect(ob.mine()).toHaveLength(0);
  });
  it('offline: nada é enviado e nada se perde', async () => {
    const { ob, s } = mk(); online = false; await ob.enqueue(P()); await ob.sync();
    expect(s.calls).toHaveLength(0); expect(ob.pendingCount()).toBe(1);
    online = true; await ob.sync(); expect(s.rows.size).toBe(1);
  });
  it('sessão expirada: mantém a operação, bloqueia envio e retoma após renovar', async () => {
    const { ob, s } = mk(); await ob.enqueue(P()); s.failWith(new AppError('auth', 'auth', 'expirou'));
    await ob.sync(); expect(ob.authBlocked.value).toBe(true); expect(ob.pendingCount()).toBe(1); expect(s.rows.size).toBe(0);
    refresh = async () => true; s.failWith(new AppError('auth', 'auth', 'expirou')); await ob.sync();
    expect(s.rows.size).toBe(1); expect(ob.pendingCount()).toBe(0); expect(ob.authBlocked.value).toBe(false);
  });
  it('troca de conta: pendências de A jamais são enviadas com a identidade de B', async () => {
    const { ob, s } = mk(); await ob.enqueue(P()); user = 'B'; await ob.sync();
    expect(s.calls).toHaveLength(0); expect(ob.mine()).toHaveLength(0); expect(ob.others()).toHaveLength(1);
    await ob.enqueue(P({ description: 'do B' })); await ob.sync(); expect(s.rows.size).toBe(1);
    await ob.discardOthers(); expect(ob.ops.value).toHaveLength(0);
    user = 'A'; await ob.enqueue(P()); await ob.purgeUser('A'); expect(ob.ops.value).toHaveLength(0);
  });
  it('sem usuário não enfileira', async () => { const { ob } = mk(); user = null; await expect(ob.enqueue(P())).rejects.toMatchObject({ kind: 'auth' }); });
  it('"syncing" órfão (app fechado no meio) volta a pendente ao carregar', async () => {
    const { ob } = mk(); const op = await ob.enqueue(P());
    const { opsDb } = await import('../../src/lib/idb.ts'); await opsDb.put({ ...op, status: 'syncing' });
    const fresh = mk().ob; await fresh.load(); expect(fresh.mine()[0].status).toBe('pending');
  });
});
