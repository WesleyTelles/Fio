import { describe, it, expect } from 'vitest';
import { interpretDeterministic as I, normalizeModelOutput as N, findAmounts } from '../../supabase/functions/_shared/interpret.ts';
import type { CategoryLite } from '../../supabase/functions/_shared/schema.ts';

const ex = (key: string, name: string): CategoryLite => ({ key, name, kind: 'expense' });
const CATS: CategoryLite[] = [
  ex('alimentacao', 'Alimentação'), ex('transporte', 'Transporte'), ex('moradia', 'Moradia'), ex('saude', 'Saúde'), ex('educacao', 'Educação'),
  ex('lazer', 'Lazer'), ex('compras', 'Compras'), ex('assinaturas', 'Assinaturas'), ex('outros', 'Outros'),
  { key: 'salario', name: 'Salário', kind: 'income' }, { key: 'renda-extra', name: 'Renda extra', kind: 'income' }, { key: 'outras-receitas', name: 'Outras receitas', kind: 'income' },
];
const ctx = { today: '2026-10-21', categories: CATS };
const prop = (t: string) => { const r = I(t, ctx); if (r.status !== 'proposal') throw new Error(`${t} → ${JSON.stringify(r)}`); return r.proposal; };

describe('frases do enunciado', () => {
  it('Gastei 8 reais com coxinha.', () => { expect(prop('Gastei 8 reais com coxinha.')).toMatchObject({ type: 'expense', amount: 8, description: 'Coxinha', category_key: 'alimentacao', category_suggested: false, date: '2026-10-21', currency: 'BRL' }); });
  it('Paguei 42,50 no almoço.', () => { expect(prop('Paguei 42,50 no almoço.')).toMatchObject({ amount: 42.5, description: 'Almoço', category_key: 'alimentacao' }); });
  it('Recebi 250 reais de um freela.', () => { expect(prop('Recebi 250 reais de um freela.')).toMatchObject({ type: 'income', amount: 250, category_key: 'renda-extra' }); });
  it('Gastei 35 no mercado ontem.', () => { expect(prop('Gastei 35 no mercado ontem.')).toMatchObject({ amount: 35, description: 'Mercado', category_key: 'alimentacao', category_suggested: true, date: '2026-10-20' }); });
  it('Paguei 120 reais de internet.', () => { expect(prop('Paguei 120 reais de internet.')).toMatchObject({ amount: 120, description: 'Internet', category_key: 'moradia' }); });
  it('Recebi meu salário de 3.200 reais.', () => { expect(prop('Recebi meu salário de 3.200 reais.')).toMatchObject({ type: 'income', amount: 3200, category_key: 'salario' }); });
});

describe('ambiguidade: não inventa', () => {
  it('"Gastei 20 reais" pede descrição', () => { const r = I('Gastei 20 reais', ctx); expect(r).toMatchObject({ status: 'clarify', missing: 'description', partial: { amount: 20, type: 'expense' } }); });
  it('descrição sem categoria conhecida pede categoria', () => { expect(I('Gastei 15 com xyzzy', ctx)).toMatchObject({ status: 'clarify', missing: 'category', partial: { description: 'Xyzzy' } }); });
  it('dois valores => pede o valor', () => { expect(I('Gastei 3 vezes 20 no uber', ctx)).toMatchObject({ status: 'clarify', missing: 'amount' }); });
  it('valor com "reais" resolve a ambiguidade', () => { expect(prop('Gastei 8 reais com 2 coxinhas').amount).toBe(8); });
  it('entrada e saída na mesma frase', () => { expect(I('Recebi 50 e gastei 30', ctx)).toMatchObject({ status: 'clarify', missing: 'type' }); });
  it('sem valor', () => { expect(I('Gastei com coxinha', ctx)).toMatchObject({ status: 'clarify', missing: 'amount' }); });
  it('data futura pede esclarecimento', () => { expect(I('Gastei 20 no mercado amanhã', ctx)).toMatchObject({ status: 'clarify', missing: 'date' }); expect(I('Paguei 20 no uber dia 30/12', ctx)).toMatchObject({ status: 'clarify', missing: 'date' }); expect(I('Paguei 20 no uber 31/02', ctx)).toMatchObject({ status: 'clarify', missing: 'date' }); });
  it('dia da semana é ambíguo localmente', () => { expect(I('Paguei 20 de uber na sexta', ctx)).toMatchObject({ status: 'clarify', missing: 'date' }); });
});

describe('perguntas não são lançamentos', () => {
  it.each([['Quanto gastei esta semana?', 'week'], ['Como está meu orçamento?', 'budget'], ['Como estão minhas metas?', 'goals'], ['Posso gastar 50 no mercado?', 'general'], ['Quanto gastei no mês?', 'month']])('%s', (t, topic) => expect(I(t, ctx)).toEqual({ status: 'question', topic }));
  it('texto aleatório', () => { expect(I('bom dia', ctx)).toEqual({ status: 'unknown' }); expect(I('', ctx)).toEqual({ status: 'unknown' }); });
});

describe('datas e valores', () => {
  it('ontem, anteontem, dia N, dd/mm', () => {
    expect(prop('Paguei 10 no pão anteontem').date).toBe('2026-10-19');
    expect(prop('Paguei 10 no pão dia 15').date).toBe('2026-10-15');
    expect(prop('Paguei 10 no pão dia 25').date).toBe('2026-09-25'); // dia 25 ainda não chegou => mês anterior
    expect(prop('Paguei 10 no pão 05/10').date).toBe('2026-10-05');
  });
  it('a data não vira valor', () => { expect(findAmounts('paguei 10 no pao 05/10')).toHaveLength(1); expect(prop('Paguei 10 no pão dia 15').amount).toBe(10); });
  it('mil / k / milhar', () => { expect(prop('Recebi 1,5 mil de freela').amount).toBe(1500); expect(prop('Recebi 2k de freela').amount).toBe(2000); expect(prop('Recebi 1.234,56 de freela').amount).toBe(1234.56); });
  it('categoria personalizada tem prioridade', () => {
    const c = { today: '2026-10-21', categories: [...CATS, { key: '11111111-1111-1111-1111-111111111111', name: 'Pets', kind: 'expense' as const }] };
    const r = I('Gastei 40 com ração pets', c); expect(r).toMatchObject({ status: 'proposal', proposal: { category_key: '11111111-1111-1111-1111-111111111111', category_suggested: false } });
  });
});

describe('saída do modelo: nunca confiar', () => {
  const base = { intent: 'register' as const, type: 'expense' as const, amount: 8, description: 'Coxinha', category: 'alimentacao', date: null, needs_clarification: false };
  it('aceita saída coerente', () => { expect(N(base, 'Gastei 8 reais com coxinha', ctx)).toMatchObject({ status: 'proposal', proposal: { amount: 8, category_key: 'alimentacao', date: '2026-10-21' } }); });
  it('rejeita valor alucinado (não está no texto)', () => { expect(N({ ...base, amount: 800 }, 'Gastei 8 reais com coxinha', ctx)).toMatchObject({ status: 'clarify', missing: 'amount' }); });
  it('categoria inventada ou do tipo errado => sugestão local ou esclarecimento', () => {
    expect(N({ ...base, category: 'cripto' }, 'Gastei 8 com coxinha', ctx)).toMatchObject({ status: 'proposal', proposal: { category_key: 'alimentacao' } });
    expect(N({ ...base, category: 'salario', description: 'Xyzzy' }, 'Gastei 8 com xyzzy', ctx)).toMatchObject({ status: 'clarify', missing: 'category' });
  });
  it('data do modelo é ignorada; o servidor decide', () => { expect(N({ ...base, date: '2020-01-01' }, 'Gastei 8 com coxinha', ctx)).toMatchObject({ proposal: { date: '2026-10-21' } }); expect(N({ ...base, date: '2026-10-19' }, 'Gastei 8 com coxinha na segunda', ctx)).toMatchObject({ proposal: { date: '2026-10-19' } }); expect(N({ ...base, date: '2030-01-01' }, 'Gastei 8 com coxinha na segunda', ctx)).toMatchObject({ status: 'clarify', missing: 'date' }); });
  it('pergunta nunca vira lançamento mesmo se o modelo errar', () => { expect(N(base, 'Posso gastar 8 com coxinha?', ctx)).toMatchObject({ status: 'question' }); });
  it('sem descrição de despesa => esclarece', () => { expect(N({ ...base, description: null }, 'Gastei 8 reais', ctx)).toMatchObject({ status: 'clarify', missing: 'description' }); });
  it('modelo pediu esclarecimento => respeita', () => { expect(N({ ...base, needs_clarification: true, missing: 'category' }, 'Gastei 8 com coxinha', ctx)).toMatchObject({ status: 'clarify', missing: 'category' }); });
  it('confiança baixa marca como sugestão', () => { expect(N({ ...base, confidence: 0.4 }, 'Gastei 8 com coxinha', ctx)).toMatchObject({ proposal: { category_suggested: true, confidence: 0.4 } }); });
  it('sem tipo => esclarece', () => { expect(N({ ...base, type: null }, 'Gastei 8 com coxinha', ctx)).toMatchObject({ status: 'clarify', missing: 'type' }); });
});
