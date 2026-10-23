// Datas civis (YYYY-MM-DD) sem depender do fuso do dispositivo.

export const isISODate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) &&
  new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

/** Data de "hoje" no fuso informado (ex.: America/Sao_Paulo), independentemente do relógio local. */
export function todayIn(tz: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const parts = (d: string) => d.split('-').map(Number) as [number, number, number];
export const addDays = (d: string, n: number): string => {
  const [y, m, day] = parts(d);
  return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
export const monthStart = (d: string): string => d.slice(0, 8) + '01';
export const addMonths = (d: string, n: number): string => {
  const [y, m] = parts(d);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
};
export const monthEnd = (d: string): string => addDays(addMonths(d, 1), -1);
export const daysInMonth = (d: string): number => daysBetween(monthStart(d), addMonths(d, 1));
export const clampDay = (monthStartISO: string, day: number): string =>
  monthStartISO.slice(0, 8) + String(Math.min(day, daysInMonth(monthStartISO))).padStart(2, '0');

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const shortDate = (d: string) => { const [, m, day] = parts(d); return `${day} ${MESES[m - 1]}`; };
export const dow = (d: string) => DOW[new Date(d + 'T12:00:00Z').getUTCDay()];
export const longDate = (d: string) => `${dow(d)}, ${shortDate(d)} ${d.slice(0, 4)}`;
export const monthLabel = (d: string) => { const [y, m] = parts(d); const n = MESES_LONGOS[m - 1]; return n[0].toUpperCase() + n.slice(1) + ' ' + y; };
export const groupLabel = (d: string, today: string) =>
  d === today ? 'Hoje' : d === addDays(today, -1) ? 'Ontem' : `${dow(d)}, ${shortDate(d)}`;
