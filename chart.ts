// Lógica pura do gráfico de evolução do saldo (sem DOM): fatiar períodos, sobrepor pendências, escalar e desenhar a curva.
import { toCents } from '../../supabase/functions/_shared/money.ts';
import type { PendingOp } from './types.ts';

export interface SeriesPt { d: string; balance: number }
export type Range = '7d' | '30d' | '90d' | '1y';
export const RANGES: Array<{ id: Range; label: string; days: number; long: string }> = [
  { id: '7d', label: '7D', days: 7, long: 'últimos 7 dias' }, { id: '30d', label: '30D', days: 30, long: 'últimos 30 dias' },
  { id: '90d', label: '90D', days: 90, long: 'últimos 90 dias' }, { id: '1y', label: '1A', days: 365, long: 'último ano' },
];
export const SERIES_DAYS = 365;

/** Últimos `days` dias + o ponto-base (saldo no fim do dia anterior), para a variação incluir o 1º dia. */
export function sliceRange(series: SeriesPt[], r: Range): SeriesPt[] {
  const days = RANGES.find((x) => x.id === r)!.days;
  return series.slice(-(days + 1));
}

/** Sobrepõe lançamentos criados offline (ainda na fila) à série do servidor. Em centavos, sem erro de float. */
export function applySeriesPending(series: SeriesPt[], ops: PendingOp[]): SeriesPt[] {
  const live = ops.filter((o) => o.kind === 'create_tx' && o.status !== 'rejected');
  if (!live.length || !series.length) return series;
  const cents = series.map((p) => toCents(p.balance));
  for (const o of live) {
    const v = toCents(o.payload.amount) * (o.payload.type === 'income' ? 1 : -1);
    for (let i = 0; i < series.length; i++) if (series[i].d >= o.payload.occurred_on) cents[i] += v;
  }
  return series.map((p, i) => ({ d: p.d, balance: cents[i] / 100 }));
}

export function delta(pts: SeriesPt[]): { abs: number; pct: number | null } {
  if (pts.length < 2) return { abs: 0, pct: null };
  const first = toCents(pts[0].balance), last = toCents(pts[pts.length - 1].balance), abs = (last - first) / 100;
  return { abs, pct: Math.abs(first) < 100 ? null : Math.round(((last - first) / Math.abs(first)) * 1000) / 10 };
}

export const isFlat = (pts: SeriesPt[]) => pts.every((p) => p.balance === pts[0]?.balance);

export interface XY { x: number; y: number }
/** Mapeia os pontos para o retângulo w×h. Eixo Y com folga; série constante fica centralizada. */
export function toXY(pts: SeriesPt[], w: number, h: number, padY = 14): XY[] {
  if (!pts.length) return [];
  const vs = pts.map((p) => p.balance), min = Math.min(...vs), max = Math.max(...vs), span = max - min;
  const top = padY, bot = h - padY;
  return pts.map((p, i) => ({
    x: pts.length === 1 ? w : (i / (pts.length - 1)) * w,
    y: span === 0 ? (top + bot) / 2 : bot - ((p.balance - min) / span) * (bot - top),
  }));
}

/** Curva suave monótona (Fritsch–Carlson): não "passa" dos valores reais, sem picos falsos entre os dias. */
export function monotonePath(p: XY[]): string {
  const n = p.length; if (!n) return ''; if (n === 1) return `M${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`;
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx.push(p[i + 1].x - p[i].x); m.push((p[i + 1].y - p[i].y) / (dx[i] || 1)); }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(p[i].x + h).toFixed(1)} ${(p[i].y + t[i] * h).toFixed(1)} ${(p[i + 1].x - h).toFixed(1)} ${(p[i + 1].y - t[i + 1] * h).toFixed(1)} ${p[i + 1].x.toFixed(1)} ${p[i + 1].y.toFixed(1)}`;
  }
  return d;
}
export const areaPath = (line: string, p: XY[], h: number) => (p.length ? `${line}L${p[p.length - 1].x.toFixed(1)} ${h}L${p[0].x.toFixed(1)} ${h}Z` : '');

/** Índice do ponto mais próximo de um x (0..w). */
export const nearest = (p: XY[], x: number) => { let b = 0; for (let i = 1; i < p.length; i++) if (Math.abs(p[i].x - x) < Math.abs(p[b].x - x)) b = i; return b; };
