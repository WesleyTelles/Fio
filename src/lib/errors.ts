export type ErrKind = 'network' | 'auth' | 'validation' | 'conflict' | 'notfound' | 'rate' | 'insufficient' | 'forbidden' | 'server' | 'disabled';
export class AppError extends Error {
  kind: ErrKind; code: string;
  constructor(kind: ErrKind, code: string, message: string) { super(message); this.kind = kind; this.code = code; }
}

const FIELD: Record<string, string> = {
  amount: 'Valor inválido. Use um valor maior que zero com até 2 casas decimais.', description: 'Informe uma descrição.',
  date: 'Data inválida.', category: 'Categoria inválida para este lançamento.', category_kind: 'A categoria não combina com o tipo (despesa/receita).',
  category_archived: 'Esta categoria foi arquivada. Escolha outra.', limit: 'Limite inválido.', target: 'Valor da meta inválido.',
  deadline: 'O prazo precisa ser uma data futura.', initial: 'Valor inicial inválido.', timezone: 'Fuso horário inválido.', confirm: 'Confirmação incorreta.',
  type: 'Tipo inválido.', kind: 'Operação inválida.', range: 'Período inválido.', idempotency_key: 'Operação inválida.', immutable: 'Este campo não pode ser alterado.',
};

/** Traduz erros do Supabase/PostgREST/GoTrue/Functions em mensagens seguras, sem SQL nem detalhes internos. */
export function mapError(e: unknown, status?: number): AppError {
  if (e instanceof AppError) return e;
  const err = e as { message?: string; code?: string; status?: number; name?: string } | null;
  const msg = String(err?.message ?? '');
  const st = status ?? err?.status;
  if (st === 0 || /failed to fetch|networkerror|load failed|network request failed|aborted|timeout|timed out/i.test(msg) && !err?.code)
    return new AppError('network', 'network', 'Sem conexão com o servidor.');
  if (st === 401 || err?.code === 'PGRST301' || /jwt expired|invalid jwt|E_NOT_AUTHENTICATED|not authenticated|refresh.?token/i.test(msg))
    return new AppError('auth', 'auth', 'Sua sessão expirou. Entre novamente.');
  const m = /E_([A-Z_]+)(?::([a-z_]+))?/.exec(msg);
  if (m) {
    const [, code, field] = m;
    if (code === 'VALIDATION') return new AppError('validation', `validation:${field}`, FIELD[field ?? ''] ?? 'Dados inválidos.');
    if (code === 'NOT_FOUND') return new AppError('notfound', 'not_found', 'Registro não encontrado. Atualize a tela.');
    if (code === 'CONFLICT') return new AppError('conflict', 'conflict', 'Este lançamento foi alterado em outro dispositivo. Atualize e tente de novo.');
    if (code === 'INSUFFICIENT_BALANCE') return new AppError('insufficient', 'insufficient_balance', 'Saldo disponível insuficiente para guardar esse valor.');
    if (code === 'INSUFFICIENT_FUNDS') return new AppError('insufficient', 'insufficient_funds', 'A meta não tem esse valor guardado.');
    if (code === 'RATE_LIMIT') return new AppError('rate', 'rate', 'Muitas tentativas. Aguarde um instante.');
  }
  if (err?.code === '42501' || st === 403) return new AppError('forbidden', 'forbidden', 'Você não tem permissão para essa operação.');
  if (err?.code === '23505') return new AppError('validation', 'duplicate', 'Já existe um registro igual.');
  if (st === 429) return new AppError('rate', 'rate', 'Muitas tentativas. Aguarde um instante.');
  return new AppError('server', 'server', 'Algo deu errado do nosso lado. Tente novamente.');
}
