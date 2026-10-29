import { useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';
import { Skeleton } from './ui';
import { mask } from './Balance';
import { areaPath, delta, isFlat, monotonePath, nearest, RANGES, sliceRange, toXY, type Range, type SeriesPt } from '../domain/chart';
import { fmtBRL } from '../../supabase/functions/_shared/money';
import { longDate, shortDate } from '../../supabase/functions/_shared/dates';

const W = 360, H = 150;
const load = (): Range => { try { const v = localStorage.getItem('fio.range'); return RANGES.some((r) => r.id === v) ? (v as Range) : '30d'; } catch { return '30d'; } };
const pctTxt = (p: number) => (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';

/** Evolução do saldo: linha lima com área em degradê, períodos 7D/30D/90D/1A e leitura por toque/arraste/teclado. */
export function BalanceChart({ series, hidden, todayS, loading }: { series: SeriesPt[] | null; hidden: boolean; todayS: string; loading: boolean }) {
  const [range, setRange] = useState<Range>(load);
  const [idx, setIdx] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const pick = (r: Range) => { setRange(r); setIdx(null); try { localStorage.setItem('fio.range', r); } catch { /* sem storage */ } };

  const pts = useMemo(() => (series ? sliceRange(series, range) : []), [series, range]);
  const xy = useMemo(() => toXY(pts, W, H), [pts]);
  const line = useMemo(() => monotonePath(xy), [xy]);
  const flat = pts.length < 2 || isFlat(pts);
  const d = delta(pts), up = d.abs >= 0;
  const rng = RANGES.find((r) => r.id === range)!;
  const cur = idx ?? pts.length - 1, at = pts[cur], dot = xy[cur];
  const on = (e: PointerEvent) => { const r = box.current?.getBoundingClientRect(); if (!r || !xy.length) return; setIdx(nearest(xy, ((e.clientX - r.left) / r.width) * W)); };
  const key = (e: KeyboardEvent) => {
    const k = e.key; if (!pts.length) return;
    if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); setIdx(Math.max(0, Math.min(pts.length - 1, cur + (k === 'ArrowLeft' ? -1 : 1)))); }
    else if (k === 'Home') { e.preventDefault(); setIdx(0); } else if (k === 'End') { e.preventDefault(); setIdx(pts.length - 1); } else if (k === 'Escape') setIdx(null);
  };

  if (!series && loading) return <div style="margin-top:22px"><Skeleton h={190} r={20} /></div>;
  if (!series) return null; // falhou ou ainda sem dados: o resto da tela segue funcionando

  const dateLbl = (p: SeriesPt) => (p.d === todayS ? 'Hoje' : longDate(p.d));
  const vt = at ? `${dateLbl(at)}: ${hidden ? 'saldo oculto' : fmtBRL(at.balance)}` : '';
  const summary = flat ? `Saldo sem variação nos ${rng.long}.` : `Saldo ${up ? 'subiu' : 'caiu'} ${hidden ? '' : fmtBRL(Math.abs(d.abs)) + ' '}nos ${rng.long}.`;

  return (
    <section aria-label="Evolução do saldo" class="chart-card" style="margin-top:22px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-height:44px">
        <div style="min-width:0">
          <div class="muted" style="letter-spacing:.1em;text-transform:uppercase;font-weight:500">Evolução do saldo</div>
          {idx !== null && at
            ? <div style="margin-top:6px;min-height:28px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap" data-testid="chart-readout"><b style="font-size:20px;font-weight:700;letter-spacing:-.02em">{mask(hidden, fmtBRL(at.balance))}</b><span class="muted">{dateLbl(at)}</span></div>
            : <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;min-height:28px" data-testid="chart-delta">
            {flat ? <span class="muted">Sem variação nos {rng.long}</span> : <>
              <span class="tag" style={{ color: up ? 'var(--lime)' : 'var(--danger)' }}><Icon n={up ? 'arrowUR' : 'arrowDL'} size={14} sw={2.4} />{hidden ? '••••' : (up ? '+' : '−') + fmtBRL(Math.abs(d.abs))}</span>
              {d.pct != null && !hidden && <span style={{ fontSize: '13px', fontWeight: 600, color: up ? 'var(--lime)' : 'var(--danger)' }}>{pctTxt(d.pct)}</span>}
              <span class="muted" style="font-size:12px">{rng.long}</span></>}
          </div>}
        </div>
      </div>

      <div ref={box} class="chart-plot" role="slider" tabIndex={0} aria-label="Evolução do saldo. Use as setas para ver cada dia."
        aria-valuemin={0} aria-valuemax={Math.max(0, pts.length - 1)} aria-valuenow={cur} aria-valuetext={vt}
        onPointerDown={on} onPointerMove={on} onPointerLeave={() => setIdx(null)} onPointerCancel={() => setIdx(null)}
        onPointerUp={(e) => { if (e.pointerType !== 'mouse') setIdx(null); }} onKeyDown={key} onBlur={() => setIdx(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true" style="display:block;overflow:visible">
          <defs><linearGradient id="fioArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D5FF40" stop-opacity=".30" /><stop offset="1" stop-color="#D5FF40" stop-opacity="0" /></linearGradient></defs>
          {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke" />)}
          {!flat && <path d={areaPath(line, xy, H)} fill="url(#fioArea)" key={'a' + range} class="chart-area" />}
          <path d={line} fill="none" stroke={flat ? 'var(--gray3)' : '#D5FF40'} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"
            stroke-dasharray={flat ? '4 6' : undefined} pathLength={flat ? undefined : 1} key={'l' + range} class={flat ? '' : 'chart-line'} />
          {dot && idx !== null && <line x1={dot.x} x2={dot.x} y1="0" y2={H} stroke="var(--gray3)" stroke-width="1" stroke-dasharray="3 4" vector-effect="non-scaling-stroke" />}
          {dot && <><circle cx={dot.x} cy={dot.y} r="9" fill="#D5FF40" opacity=".18" /><circle cx={dot.x} cy={dot.y} r="4.5" fill="#D5FF40" stroke="#10110F" stroke-width="2" /></>}
        </svg>
      </div>

      <div style="display:flex;justify-content:space-between;margin-top:6px" class="muted" aria-hidden="true"><span>{pts[0] ? shortDate(pts[1]?.d ?? pts[0].d) : ''}</span><span>Hoje</span></div>
      <div class="seg" role="group" aria-label="Período do gráfico" style="margin-top:12px">
        {RANGES.map((r) => <button key={r.id} aria-pressed={range === r.id} onClick={() => pick(r.id)}>{r.label}</button>)}
      </div>
      <p class="sr" role="status">{summary}</p>
    </section>
  );
}
