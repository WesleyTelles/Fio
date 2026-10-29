import { describe, it, expect } from 'vitest';
import { parseBRL, fmtBRL, toCents, sumCents } from '../../supabase/functions/_shared/money.ts';
import { addDays, addMonths, daysBetween, daysInMonth, isISODate, monthEnd, todayIn, groupLabel } from '../../supabase/functions/_shared/dates.ts';

describe('dinheiro', () => {
  it.each([['8', 8], ['8,5', 8.5], ['42,50', 42.5], ['3.200', 3200], ['3.200,50', 3200.5], ['1.234.567,89', 1234567.89], ['R$ 8', 8], ['8.5', 8.5], ['0,99', 0.99]])('parseBRL(%s)', (s, v) => expect(parseBRL(s as string)).toBe(v));
  it.each(['', 'abc', '-5', '0', '0,00', '1,234', '12,345,6', '1..2', '1.23.4', '99999999999', 'R$'])('rejeita %j', (s) => expect(parseBRL(s)).toBeNull());
  it('sem erro de ponto flutuante', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumCents([0.1, 0.2])).toBe(0.3);
    expect(toCents(19.99)).toBe(1999);
  });
  it('formata em reais', () => { expect(fmtBRL(1234.5)).toBe('R$ 1.234,50'); expect(fmtBRL(-8)).toBe('−R$ 8,00'); expect(fmtBRL(0)).toBe('R$ 0,00'); });
});

describe('datas', () => {
  it('valida ISO', () => { expect(isISODate('2026-02-28')).toBe(true); expect(isISODate('2026-02-30')).toBe(false); expect(isISODate('2026-13-01')).toBe(false); expect(isISODate('26-1-1')).toBe(false); expect(isISODate(5)).toBe(false); });
  it('limites de mês e bissexto', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01'); expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysInMonth('2028-02-10')).toBe(29); expect(daysInMonth('2026-02-10')).toBe(28);
    expect(monthEnd('2026-10-05')).toBe('2026-10-31'); expect(addMonths('2026-12-15', 1)).toBe('2027-01-01'); expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
    expect(daysBetween('2026-10-21', '2026-12-20')).toBe(60);
  });
  it('"hoje" respeita o fuso do usuário (virada de dia)', () => {
    const t = new Date('2026-10-22T01:30:00Z'); // 22:30 de 21/10 em São Paulo (UTC-3)
    expect(todayIn('America/Sao_Paulo', t)).toBe('2026-10-21');
    expect(todayIn('UTC', t)).toBe('2026-10-22');
    expect(todayIn('Asia/Tokyo', t)).toBe('2026-10-22');
    expect(todayIn('Fuso/Invalido', t)).toBe('2026-10-22');
  });
  it('rótulos', () => { expect(groupLabel('2026-10-21', '2026-10-21')).toBe('Hoje'); expect(groupLabel('2026-10-20', '2026-10-21')).toBe('Ontem'); expect(groupLabel('2026-10-05', '2026-10-21')).toBe('seg, 5 out'); });
});
