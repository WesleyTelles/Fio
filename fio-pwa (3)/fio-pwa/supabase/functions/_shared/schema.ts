import { z } from 'zod';

export const TOPICS = ['week', 'month', 'budget', 'goals', 'plan', 'general'] as const;
export const MISSING = ['description', 'category', 'amount', 'type', 'date'] as const;
export type Topic = (typeof TOPICS)[number];
export type Missing = (typeof MISSING)[number];

/** Contrato que o modelo de IA deve devolver. NADA aqui é confiável até passar por normalize(). */
export const LlmOutputSchema = z.object({
  intent: z.enum(['register', 'question', 'unknown']),
  type: z.enum(['expense', 'income']).nullish(),
  amount: z.number().positive().max(999999999.99).nullish(),
  description: z.string().max(200).nullish(),
  category: z.string().max(60).nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  needs_clarification: z.boolean(),
  missing: z.enum(MISSING).nullish(),
  topic: z.enum(TOPICS).nullish(),
  confidence: z.number().min(0).max(1).nullish(),
});
export type LlmOutput = z.infer<typeof LlmOutputSchema>;

/** JSON Schema equivalente (para saída estruturada via tool_use). Mantido à mão e coberto por teste. */
export const LLM_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'needs_clarification'],
  properties: {
    intent: { type: 'string', enum: ['register', 'question', 'unknown'] },
    type: { type: ['string', 'null'], enum: ['expense', 'income', null] },
    amount: { type: ['number', 'null'], description: 'Valor em reais, positivo, até 2 casas decimais.' },
    description: { type: ['string', 'null'], description: 'Descrição curta. Nunca invente: null se o usuário não disse.' },
    category: { type: ['string', 'null'], description: 'Uma das chaves de categoria fornecidas, ou null.' },
    date: { type: ['string', 'null'], description: 'YYYY-MM-DD; null se o usuário não citou data.' },
    needs_clarification: { type: 'boolean' },
    missing: { type: ['string', 'null'], enum: [...MISSING, null] },
    topic: { type: ['string', 'null'], enum: [...TOPICS, null] },
    confidence: { type: ['number', 'null'] },
  },
} as const;

export interface CategoryLite { key: string; name: string; kind: 'expense' | 'income' }

export interface Proposal {
  type: 'expense' | 'income';
  amount: number;
  currency: 'BRL';
  description: string;
  category_key: string;
  category_suggested: boolean;
  date: string;
  confidence?: number;
}
export interface Partial_ { type?: 'expense' | 'income'; amount?: number; description?: string; date?: string }

export type InterpretResult =
  | { status: 'proposal'; proposal: Proposal }
  | { status: 'clarify'; missing: Missing; question: string; partial: Partial_ }
  | { status: 'question'; topic: Topic }
  | { status: 'unknown' };

export const MAX_TEXT = 280;
