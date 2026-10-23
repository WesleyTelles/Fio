# Estado do projeto Supabase "fio" (ref `ilbsgdrdykwfhtjtbgym`, região sa-east-1)

Feito pelo assistente via conector em 23/10/2026:
- Migrações 0001–0004 aplicadas (tabelas, RLS FORCE, funções, permissões). Verificador de segurança do Supabase: 0 alertas.
- Teste na base real (transação revertida): idempotência (`duplicate=true`), isolamento (usuário B vê 0 linhas e não edita dado de A: `E_NOT_FOUND`), saldo calculado.
- Edge Function `interpret` publicada (v2, `verify_jwt=true`), com suporte a Gemini e Claude.
- `delete_my_account` criada pelo usuário no SQL Editor e conferida (existe, só `authenticated` executa).

Diferenças em relação ao repositório:
1. `ai_take_quota` em produção **não apaga** chamadas antigas (o conector bloqueia DELETE sem aprovação). Efeito: a tabela `ai_calls` cresce (máx. 200 linhas/usuário/dia); a cota continua correta. Para voltar ao comportamento do repositório, aplique `supabase/migrations/0003_functions.sql` (trecho de `ai_take_quota`) com `create or replace`.

Pendente (precisa de você): `GEMINI_API_KEY` (ou `ANTHROPIC_API_KEY`), digitada só no painel, `ALLOWED_ORIGIN` (domínio final), publicação do front, Auth (URLs, SMTP, confirmação de e-mail).
