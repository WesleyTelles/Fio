import { useEffect, useRef, useState } from 'preact/hooks';
import { fmtBRL } from '../../supabase/functions/_shared/money';

const reduce = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const mask = (hidden: boolean, text: string) => (hidden ? 'R$ ••••' : text);

/** Saldo grande. Ao ocultar/mostrar: os dígitos "giram" em lima e assentam um a um (revelação) ou viram • (oculto). */
export function Balance({ value, hidden }: { value: number; hidden: boolean }) {
  const full = fmtBRL(Math.abs(value)).replace('R$ ', '');           // "1.234,56"
  const [int, dec] = full.split(',');
  const neg = value < 0;
  const [cells, setCells] = useState<{ c: string; lime: boolean }[]>(() => hidden ? [...int].filter((c) => /\d/.test(c)).map(() => ({ c: '•', lime: false })) : [...int].map((c) => ({ c, lime: false })));
  const [showDec, setShowDec] = useState(!hidden);
  const prev = useRef(hidden); const raf = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    const target = hidden ? [...int].filter((c) => /\d/.test(c)).map(() => '•') : [...int];
    if (reduce() || prev.current === hidden && cells.length) { setCells(target.map((c) => ({ c, lime: false }))); setShowDec(!hidden); prev.current = hidden; return; }
    prev.current = hidden;
    const t0 = performance.now(); const n = target.length;
    const tick = (now: number) => {
      const el = now - t0; let done = true;
      const next = target.map((tc, k) => {
        const settleAt = 200 + (hidden ? k : n - 1 - k) * 70;
        if (el >= settleAt) return { c: tc, lime: false };
        done = false; return { c: /\d|•/.test(tc) ? String(Math.floor(Math.random() * 10)) : tc, lime: true };
      });
      setCells(next); setShowDec(hidden ? el < 120 : el > 200 + n * 70 / 2);
      if (!done) raf.current = requestAnimationFrame(tick); else setShowDec(!hidden);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [hidden, value]);
  const aria = hidden ? 'Saldo oculto' : `Saldo ${fmtBRL(value)}`;
  return (
    <div role="img" aria-label={aria} data-testid="balance" style="display:flex;align-items:baseline;margin-top:2px;min-height:64px">
      <span style="font-size:20px;font-weight:600;color:var(--gray);margin-right:8px">{neg && !hidden ? '−R$' : 'R$'}</span>
      <span style="display:inline-flex;font-size:clamp(44px,15vw,60px);font-weight:700;letter-spacing:-.04em;line-height:1">
        {cells.map((x, i) => <span key={i} style={{ display: 'inline-block', color: x.lime ? 'var(--lime)' : '#fff' }}>{x.c}</span>)}
      </span>
      {showDec && !hidden && <span style="display:inline-flex;font-size:28px;font-weight:700;letter-spacing:-.02em">,{dec}</span>}
    </div>
  );
}
