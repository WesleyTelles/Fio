# Segurança — o que foi feito e o que os testes NÃO provam

## Controles implementados
- **RLS `FORCE`** em todas as tabelas; `anon`/`authenticated` sem privilégios diretos além de grants por coluna; sem `DELETE` físico em lançamentos.
- RPCs `SECURITY INVOKER` com `search_path=''`; erros de negócio com códigos estáveis (sem vazar SQL).
- Validação no servidor (triggers + RPCs): valor positivo com 2 casas, categoria do próprio usuário/tipo/não arquivada, imutabilidade de campos.
- **Segredos só no servidor:** chave de IA em `supabase secrets`; o bundle não contém `service_role` nem chave de IA (varredura de `dist/`: nenhum padrão encontrado; única string JWT é a chave **anon** pública).
- **IA:** autenticação obrigatória, cota por usuário no banco, timeout + 1 retry, mensagem de erro genérica, **sem log do texto do usuário**, saída revalidada (valor presente no texto, data do servidor, categoria real).
- **Cabeçalhos** (`vercel.json`): CSP restritiva (`script-src 'self'`, sem inline), HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
- **Cache do SW** só de estáticos; teste confirma que nenhuma URL de API entra no Cache Storage.
- `npm audit`: 0 vulnerabilidades conhecidas (no momento da execução).

## Evidência (executada localmente)
- 16 testes de banco em Postgres 16 real (inclui isolamento entre dois usuários, idempotência, exclusão de conta).
- E2E: usuário B, com token válido, **não lista, não lê por id, não edita e não exclui** registros de A; anônimo não lê nada; pendência de A não sincroniza como B.
- E2E sob a CSP de produção sem violações; controle negativo (CSP errada) quebra o app.

## Limites (leia antes de confiar)
1. **Os E2E rodam contra um gateway de teste** (`tools/gateway`) que emula GoTrue/PostgREST sobre o Postgres real com as migrações reais. Isso exercita o RLS e as RPCs de verdade, mas **não** exercita o Supabase hospedado (PostgREST real, GoTrue real, Edge Runtime/Deno, limites de plano). Rode a lista de verificação do `docs/DEPLOY.md` §4 em produção.
2. O gateway **não** valida tudo que o PostgREST real valida (operadores de filtro fora do subconjunto usado pelo app, por exemplo). O app só usa esse subconjunto.
3. **Provedor de IA real nunca foi chamado.** O adaptador Anthropic foi testado com `fetch` simulado (formato de requisição, `tool_use` forçado, tratamento de resposta inválida/timeout). Qualidade real de interpretação e id de modelo precisam ser validados.
4. **Não foi testado em iOS/Android reais** nem em Safari/Firefox; só Chromium com perfil de Pixel 7. Instalação (prompt do Android, Adicionar à Tela de Início no iOS) só foi verificada indiretamente (manifest válido, ícones acessíveis, SW ativo, reabertura offline em Chromium; sem auditoria Lighthouse) — **pendente em dispositivo**.
5. Não há teste de carga, teste de intrusão, nem revisão de terceiros. Cota de IA e RLS foram testadas funcionalmente, não sob abuso concorrente pesado.
6. Token de sessão em `localStorage` (XSS é o risco residual; mitigado por CSP, sem `innerHTML`, sem scripts externos).
7. Não há MFA, bloqueio por tentativas de login além do que o Supabase Auth oferece por padrão, nem monitoramento/alertas — configure no painel do Supabase conforme o plano.
8. Backups e PITR dependem do plano do Supabase; não foram verificados.
