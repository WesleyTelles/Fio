import { describe, expect, it } from 'vitest';
import { applySeriesPending, areaPath, delta, isFlat, monotonePath, nearest, sliceRange, toXY, type SeriesPt } from '../../src/domain/chart';
import type { PendingOp } from '../../src/domain/types';

const day = (i: number) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
const series = (vals: number[]): SeriesPt[] => vals.map((balance, i) => ({ d: day(i), balance }));
const op = (occurred_on: string, amount: number, type: 'income' | 'expense', status: PendingOp['status'] = 'pending'): PendingOp =>
  ({ id: crypto.randomUUID(), user_id: 'u', kind: 'create_tx', status, attempts: 0, created_at: '', payload: { type, amount, description: 'x', category_id: 'c', occurred_on, source: 'manual' } });

describe('gráfico do saldo', () => {
  it('fatia o período incluindo o ponto-base', () => {
    const s = series(Array.from({ length: 366 }, (_, i) => i));
    expect(sliceRange(s, '7d')).toHaveLength(8); expect(sliceRange(s, '30d')).toHaveLength(31);
    expect(sliceRange(s, '1y')).toHaveLength(366); expect(sliceRange(series([1, 2, 3]), '90d')).toHaveLength(3);
  });
  it('variação: absoluta e percentual sobre o saldo-base (sem float)', () => {
    expect(delta(series([100, 100.1, 100.3]))).toEqual({ abs: 0.3, pct: 0.3 });
    expect(delta(series([200, 150]))).toEqual({ abs: -50, pct: -25 });
    expect(delta(series([0, 50])).pct).toBeNull();            // base ~0: percentual não faz sentido
    expect(delta(series([-100, -50]))).toEqual({ abs: 50, pct: 50 }); // melhora de saldo negativo
    expect(delta(series([10]))).toEqual({ abs: 0, pct: null });
  });
  it('pendências entram a partir do dia do lançamento e rejeitadas são ignoradas', () => {
    const s = series([100, 100, 100, 100]);
    const r = applySeriesPending(s, [op(day(2), 8.1, 'expense'), op(day(1), 0.2, 'income'), op(day(0), 999, 'expense', 'rejected')]);
    expect(r.map((p) => p.balance)).toEqual([100, 100.2, 92.1, 92.1]);
    expect(s.map((p) => p.balance)).toEqual([100, 100, 100, 100]); // não muta o original
    expect(applySeriesPending(s, [op('2099-01-01', 5, 'expense')]).map((p) => p.balance)).toEqual([100, 100, 100, 100]);
    expect(applySeriesPending(s, [op('2000-01-01', 5, 'expense')]).map((p) => p.balance)).toEqual([95, 95, 95, 95]); // antes da janela: afeta tudo
  });
  it('escala: extremos nos limites, série constante centralizada', () => {
    const xy = toXY(series([10, 30, 20]), 200, 100, 10);
    expect(xy[0].x).toBe(0); expect(xy[2].x).toBe(200); expect(xy[1].y).toBe(10); expect(xy[0].y).toBe(90);
    expect(toXY(series([5, 5, 5]), 100, 100).every((p) => p.y === 50)).toBe(true);
    expect(isFlat(series([5, 5]))).toBe(true); expect(isFlat(series([5, 6]))).toBe(false);
    expect(toXY([], 10, 10)).toEqual([]);
  });
  it('curva monótona não ultrapassa os valores (sem overshoot) e fecha a área', () => {
    const xy = toXY(series([0, 0, 100, 100, 50]), 400, 100, 0);
    const d = monotonePath(xy); expect(d.startsWith('M0.0 100.0C')).toBe(true);
    const ys = [...d.matchAll(/C([\d.]+) ([\d.-]+) ([\d.]+) ([\d.-]+)/g)].flatMap((m) => [Number(m[2]), Number(m[4])]);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.01); expect(Math.max(...ys)).toBeLessThanOrEqual(100.01);
    expect(areaPath(d, xy, 120).endsWith('L400.0 120L0.0 120Z')).toBe(true);
    expect(monotonePath([])).toBe(''); expect(monotonePath([{ x: 3, y: 4 }])).toBe('M3.0 4.0');
  });
  it('ponto mais próximo do toque', () => {
    const xy = toXY(series([1, 2, 3, 4, 5]), 400, 100);
    expect(nearest(xy, 0)).toBe(0); expect(nearest(xy, 160)).toBe(2); expect(nearest(xy, 999)).toBe(4);
  });
});
