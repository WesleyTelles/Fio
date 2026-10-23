// Dinheiro: sempre inteiros em centavos para aritmética; number com 2 casas só na borda (API/UI).

export const toCents = (n: number): number => Math.round((n + Number.EPSILON) * 100);
export const fromCents = (c: number): number => c / 100;
export const sumCents = (xs: number[]): number => xs.reduce((a, b) => a + toCents(b), 0) / 100;

/** "R$ 1.234,56" (nunca "R$ -"; negativo => "−R$ 1.234,56"). */
export function fmtBRL(n: number): string {
  const neg = n < 0;
  const s = Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (neg ? '−' : '') + 'R$ ' + s;
}

/**
 * Converte texto monetário brasileiro em número com 2 casas.
 * "8" "8,5" "42,50" "3.200" "3.200,50" "1.234.567,89" "8.5"(decimal) → number
 * Rejeita: vazio, negativo, mais de 2 casas decimais, lixo, zero.
 */
export function parseBRL(input: string): number | null {
  let s = String(input ?? '').trim().replace(/^r\$\s*/i, '').replace(/\s+/g, '');
  if (!s || /[^\d.,]/.test(s)) return null;
  if (s.includes(',')) {
    if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(s)) return null;
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes('.')) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');          // milhar
    else if (!/^\d+\.\d{1,2}$/.test(s)) return null;                          // decimal com ponto
  }
  const v = Number(s);
  if (!Number.isFinite(v) || v <= 0 || v >= 1e9) return null;
  return toCents(v) / 100;
}
