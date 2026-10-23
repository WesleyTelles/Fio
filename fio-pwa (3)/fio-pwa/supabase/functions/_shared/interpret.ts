import { toCents, parseBRL, fmtBRL } from './money.ts';
import { addDays, addMonths, clampDay, daysBetween, isISODate, monthStart } from './dates.ts';
import type { CategoryLite, InterpretResult, LlmOutput, Missing, Partial_, Proposal, Topic } from './schema.ts';

export interface Ctx { today: string; categories: CategoryLite[] }

const strip = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const cap = (x: string) => { x = x.trim(); return x ? x.charAt(0).toUpperCase() + x.slice(1, 120) : x; };

// ---------------------------------------------------------------- valores
export interface AmountHit { value: number; start: number; end: number; currency: boolean }

/** Datas e "dia N" não são valores: são mascaradas antes de procurar números. */
function maskDates(low: string): string {
  return low
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, (m) => ' '.repeat(m.length))
    .replace(/\bdia\s+\d{1,2}\b/g, (m) => ' '.repeat(m.length));
}

export function findAmounts(low: string): AmountHit[] {
  const masked = maskDates(low);
  const re = /(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*(mil|k)\b)?/g;
  const out: AmountHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    let value = parseBRL(m[1]);
    if (value == null) continue;
    if (m[2]) value = toCents(value * 1000) / 100;
    const end = m.index + m[0].length;
    const before = masked.slice(Math.max(0, m.index - 3), m.index);
    const after = masked.slice(end, end + 12);
    const currency = /r\$\s*$/.test(before) || /^\s*(reais|real|conto|contos|pila|pilas|r\$)\b/.test(after) || /^\s*(reais|real|conto|contos|pila|pilas)/.test(after);
    out.push({ value, start: m.index, end, currency });
  }
  return out;
}

/** Escolhe o valor só se não houver ambiguidade. */
function pickAmount(hits: AmountHit[]): { hit?: AmountHit; ambiguous: boolean } {
  if (hits.length === 0) return { ambiguous: false };
  if (hits.length === 1) return { hit: hits[0], ambiguous: false };
  const cur = hits.filter((h) => h.currency);
  if (cur.length === 1) return { hit: cur[0], ambiguous: false };
  return { ambiguous: true };
}

// ------------------------------------------------------------------ datas
export function parseDate(norm: string, today: string): { date: string; found: boolean; future?: boolean; unknownMarker?: boolean } {
  if (/\banteontem\b/.test(norm)) return { date: addDays(today, -2), found: true };
  if (/\bontem\b/.test(norm)) return { date: addDays(today, -1), found: true };
  if (/\bamanha\b|\bdepois de amanha\b/.test(norm)) return { date: addDays(today, 1), found: true, future: true };
  if (/\bhoje\b/.test(norm)) return { date: today, found: true };
  let m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(norm);
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
    if (y < 100) y += 2000;
    const iso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!isISODate(iso)) return { date: today, found: true, future: true }; // inválida => pede esclarecimento
    return { date: iso, found: true, future: iso > today };
  }
  m = /\bdia\s+(\d{1,2})\b/.exec(norm);
  if (m) {
    const day = Number(m[1]);
    if (day < 1 || day > 31) return { date: today, found: true, future: true };
    let cand = clampDay(monthStart(today), day);
    if (cand > today) cand = clampDay(addMonths(monthStart(today), -1), day);
    return { date: cand, found: true };
  }
  if (/\b(segunda|terca|quarta|quinta|sexta|sabado|domingo|semana passada|mes passado|anteriormente)\b/.test(norm))
    return { date: today, found: false, unknownMarker: true };
  return { date: today, found: false };
}

// ------------------------------------------------------------- descrição
export function cleanDesc(str: string): string {
  let x = strip(str).replace(/[.!?]+$/, '').trim();
  x = x.replace(/\b(ontem|anteontem|hoje|amanha)\b/g, ' ').replace(/\bdia\s+\d{1,2}\b/g, ' ').replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ');
  x = x.replace(/\s+/g, ' ').trim();
  x = x.replace(/^(?:foi\s+|fui\s+)?(?:com|no|na|nos|nas|em|de|do|da|dos|das|para|pra|num|numa|pelo|pela|por|a|ao)\s+/, '');
  x = x.replace(/^(?:o|a|os|as|um|uma|uns|umas)\s+/, '');
  x = x.replace(/\s+(?:de|do|da|em|no|na|com|por|pelo|pela|pra|para)$/, '').trim();
  return x;
}

const HAS_ACCENT = (original: string, cleaned: string) => {
  // preserva acentuação original quando possível (descrição vem do texto do usuário)
  const idx = strip(original).indexOf(cleaned);
  return idx >= 0 ? original.slice(idx, idx + cleaned.length) : cleaned;
};

// -------------------------------------------------------------- categorias
interface Guess { key: string; sure: boolean }
const RULES: Array<[RegExp, string, boolean]> = [
  [/\b(supermercado|mercado|mercadinho|atacadao|sacolao)\b/, 'alimentacao', false],
  [/(coxinha|\bpao\b|padaria|almoco|jantar|lanche|\bcafe\b|pizza|restaurante|acai|hamburguer|salgado|sorvete|marmita|feira|hortifruti|ifood|bolo|suco|refrigerante|cerveja|churrasco|comida)/, 'alimentacao', true],
  [/(uber|onibus|gasolina|combustivel|metro|taxi|\b99\b|passagem|estacionamento|pedagio|bilhete|recarga de bilhete|etanol)/, 'transporte', true],
  [/(aluguel|\bluz\b|\bagua\b|internet|condominio|\bgas\b|iptu|energia|conta de luz)/, 'moradia', true],
  [/(farmacia|remedio|consulta|medico|dentista|exame|hospital|plano de saude|terapia|psicolog)/, 'saude', true],
  [/(curso|escola|faculdade|mensalidade|livro|\baula\b|matricula|apostila)/, 'educacao', true],
  [/(netflix|spotify|assinatura|prime video|disney|hbo|youtube premium|icloud|gympass|deezer)/, 'assinaturas', true],
  [/(cinema|\bshow\b|\bbar\b|\bjogo\b|viagem|festa|ingresso|balada|passeio|teatro|parque)/, 'lazer', true],
  [/(roupa|sapato|tenis|presente|eletronico|celular|amazon|shopee|mercado livre|\bloja\b|camisa)/, 'compras', true],
  [/(corte de cabelo|barbearia|salao)/, 'outros', false],
];
export function guessCategory(desc: string, type: 'expense' | 'income', cats: CategoryLite[]): Guess | null {
  const n = strip(desc);
  const has = (k: string) => cats.some((c) => c.key === k && c.kind === type);
  for (const c of cats) if (c.kind === type && /^[0-9a-f-]{36}$/.test(c.key) && n.includes(strip(c.name))) return { key: c.key, sure: true };
  if (type === 'income') {
    if (/(salario|holerite|contracheque)/.test(n) && has('salario')) return { key: 'salario', sure: true };
    if (/(freela|freelance|bico|vendi|venda|comissao|servico)/.test(n) && has('renda-extra')) return { key: 'renda-extra', sure: true };
    if (has('outras-receitas')) return { key: 'outras-receitas', sure: false };
    return null;
  }
  for (const [re, key, sure] of RULES) if (re.test(n) && has(key)) return { key, sure };
  return null;
}

// -------------------------------------------------------------- perguntas
const Q_START = /^(quanto|quantos|quantas|qual|quais|como|onde|quando|por que|porque|o que|posso|devo|da pra|consigo|tenho|estou|estao|me (mostra|diga|fale|conta|ajuda))\b/;
export function detectQuestion(norm: string): Topic | null {
  const t = norm.trim();
  if (!(t.endsWith('?') || Q_START.test(t))) return null;
  if (/\bmetas?\b|\bobjetivos?\b/.test(t)) return 'goals';
  if (/orcamento|limite/.test(t)) return 'budget';
  if (/(planejar|economiz|poupar|guardar)/.test(t)) return 'plan';
  if (/semana/.test(t)) return 'week';
  if (/\bmes\b|mensal/.test(t)) return 'month';
  return 'general';
}

const EXPENSE_V = /\b(gastei|paguei|comprei|gasto|gastou|despesa|saiu|pago|custou|pagamento)\b/;
const INCOME_V = /\b(recebi|ganhei|entrou|receita|salario|freela|freelance|vendi|reembolso|recebimento)\b/;

function fmtQ(v: number) { return fmtBRL(v); }

const clarify = (missing: Missing, question: string, partial: Partial_): InterpretResult => ({ status: 'clarify', missing, question, partial });

// -------------------------------------------------- motor determinístico
export function interpretDeterministic(textRaw: string, ctx: Ctx): InterpretResult {
  const text = String(textRaw ?? '').trim();
  const low = text.toLowerCase();
  const norm = strip(low);
  if (!text) return { status: 'unknown' };

  const q = detectQuestion(norm);
  if (q) return { status: 'question', topic: q };

  const hits = findAmounts(low);
  if (hits.length === 0) {
    if (/\b(metas?|objetivos?)\b/.test(norm)) return { status: 'question', topic: 'goals' };
    if (/orcamento/.test(norm)) return { status: 'question', topic: 'budget' };
    if (/(gastei|paguei|comprei|recebi|ganhei)/.test(norm))
      return clarify('amount', 'Qual foi o valor? Ex.: “R$ 8” ou “42,50”.', {});
    return { status: 'unknown' };
  }

  const isExp = EXPENSE_V.test(norm), isInc = INCOME_V.test(norm);
  if (isExp && isInc && !/\bsalario\b/.test(norm.replace(/(recebi|ganhei)[^.]*salario/, '')))
    return clarify('type', 'Vi uma entrada e uma saída na mesma frase. Registre uma por vez: qual vem primeiro?', {});

  const { hit, ambiguous } = pickAmount(hits);
  if (ambiguous || !hit) {
    return clarify('amount', 'Encontrei mais de um número. Qual é o valor total em reais?', {});
  }

  const type: 'expense' | 'income' = isInc ? 'income' : 'expense';
  const dp = parseDate(norm, ctx.today);
  if (dp.future) return clarify('date', 'Essa data está no futuro. Qual foi o dia da movimentação?', { type, amount: hit.value });
  if (dp.unknownMarker) return clarify('date', 'Qual foi o dia exato? Ex.: “ontem”, “dia 15” ou “15/10”.', { type, amount: hit.value });
  const date = dp.date;

  const after = low.slice(hit.end).replace(/^\s*(reais|real|conto|contos|pila|pilas)\b/, '').trim();
  let desc = cleanDesc(after);
  if (!desc) {
    const before = low.slice(0, hit.start).replace(/r\$/g, ' ')
      .replace(/\b(gastei|paguei|comprei|recebi|ganhei|gasto|gastou|despesa|receita|fiz|foi|um|uma|de|com|no|na|em|eu|meu|minha|pagamento|recebimento)\b/g, ' ').replace(/\s+/g, ' ');
    desc = cleanDesc(before);
  }
  const partial: Partial_ = { type, amount: hit.value, date };

  if (type === 'income') {
    const d = desc ? cap(HAS_ACCENT(text, desc)) : 'Receita';
    const g = guessCategory(desc || 'salario', 'income', ctx.categories) ?? guessCategory('', 'income', ctx.categories);
    if (!g) return clarify('category', 'Em qual categoria de receita isso entra?', { ...partial, description: d });
    return { status: 'proposal', proposal: { type, amount: hit.value, currency: 'BRL', description: d, category_key: g.key, category_suggested: !g.sure || !desc, date } };
  }
  if (!desc) return clarify('description', `Anotei ${fmtQ(hit.value)}. Com o que foi? Diga a descrição (ex.: almoço, Uber).`, partial);
  const description = cap(HAS_ACCENT(text, desc));
  const g = guessCategory(desc, 'expense', ctx.categories);
  if (!g) return clarify('category', `Em qual categoria entra “${description}”?`, { ...partial, description });
  return { status: 'proposal', proposal: { type, amount: hit.value, currency: 'BRL', description, category_key: g.key, category_suggested: !g.sure, date } };
}

// ---------------------------------------------------------- saída da IA
/**
 * Re-valida TUDO que o modelo devolveu. O modelo só PROPÕE: valor, data e categoria
 * são conferidos contra o texto original e contra as categorias reais do usuário.
 */
export function normalizeModelOutput(raw: LlmOutput, textRaw: string, ctx: Ctx): InterpretResult {
  const text = String(textRaw).trim();
  const norm = strip(text.toLowerCase());
  if (raw.intent === 'unknown') return { status: 'unknown' };
  if (raw.intent === 'question') {
    const topic = detectQuestion(norm) ?? raw.topic ?? 'general';
    return { status: 'question', topic };
  }
  // pergunta nunca vira lançamento, mesmo que o modelo erre
  const q = detectQuestion(norm);
  if (q) return { status: 'question', topic: q };

  const hits = findAmounts(text.toLowerCase());
  const type = raw.type ?? null;
  if (!type) return clarify('type', 'Isso foi uma despesa ou uma receita?', {});
  const partial: Partial_ = { type };

  // valor: o número do modelo precisa existir no texto (anti-alucinação)
  const picked = pickAmount(hits);
  let amount: number | null = null;
  if (raw.amount != null && hits.some((h) => toCents(h.value) === toCents(raw.amount!))) amount = toCents(raw.amount) / 100;
  else if (picked.hit && raw.amount == null) amount = null;
  if (amount == null) {
    const base = hits.length === 0 ? 'Qual foi o valor?' : 'Não consegui confirmar o valor. Qual é o valor total em reais?';
    return clarify('amount', base, partial);
  }
  partial.amount = amount;

  // data: o servidor é a autoridade; aceita a do modelo só para expressões que o parser local não cobre
  const dp = parseDate(norm, ctx.today);
  let date = dp.date;
  if (dp.future) return clarify('date', 'Essa data está no futuro. Qual foi o dia da movimentação?', partial);
  if (!dp.found && dp.unknownMarker && raw.date && isISODate(raw.date) && raw.date <= ctx.today && daysBetween(raw.date, ctx.today) <= 31) date = raw.date;
  else if (!dp.found && dp.unknownMarker) return clarify('date', 'Qual foi o dia exato? Ex.: “ontem”, “dia 15” ou “15/10”.', partial);
  partial.date = date;

  const desc = (raw.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (type === 'expense' && !desc) return clarify('description', `Anotei ${fmtQ(amount)}. Com o que foi? Diga a descrição.`, partial);
  const description = cap(desc || 'Receita');
  partial.description = description;

  const cats = ctx.categories;
  const mine = raw.category ? cats.find((c) => c.key === raw.category && c.kind === type) : undefined;
  let key: string | undefined = mine?.key;
  let suggested = raw.confidence != null ? raw.confidence < 0.7 : true;
  if (!key) {
    const g = guessCategory(description, type, cats);
    if (g) { key = g.key; suggested = !g.sure; }
  }
  if (!key) return clarify('category', `Em qual categoria entra “${description}”?`, partial);
  if (raw.needs_clarification) {
    const m: Missing = raw.missing ?? 'category';
    const qs: Record<Missing, string> = {
      description: 'Pode detalhar com o que foi?', category: `Em qual categoria entra “${description}”?`,
      amount: 'Qual é o valor total em reais?', type: 'Isso foi uma despesa ou uma receita?', date: 'Qual foi o dia da movimentação?',
    };
    return clarify(m, qs[m], partial);
  }
  const proposal: Proposal = { type, amount, currency: 'BRL', description, category_key: key, category_suggested: suggested, date };
  if (raw.confidence != null) proposal.confidence = Math.round(raw.confidence * 100) / 100;
  return { status: 'proposal', proposal };
}
