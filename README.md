# Fio — finanças pessoais com IA (PWA)

Controle financeiro pessoal por conversa: registre gastos e receitas escrevendo do seu jeito, acompanhe saldo, orçamento por categoria, metas e insights.
Instalável no celular (PWA), funciona offline para **criar** lançamentos, e os dados ficam isolados por conta (RLS no Postgres).

> **Status honesto:** o código, o banco (migrações) e a suíte de testes estão prontos e passam **localmente**. O que depende de contas/credenciais externas
> (projeto Supabase real, chave do provedor de IA, hospedagem com HTTPS) **não foi feito** — veja [`docs/DEPLOY.md`](docs/DEPLOY.md) e o
> [`RELATORIO_FINAL.md`](RELATORIO_FINAL.md) (o que está implementado / testado / publicado / pendente).

## Stack

| Camada | Tecnologia |
|---|---|
| Front | Vite 8, Preact 11, TypeScript estrito, `@preact/signals`, Poppins (self-hosted) |
| PWA | `vite-plugin-pwa` (Workbox `generateSW`, `registerType: 'prompt'`) |
| Backend | Supabase: Postgres 16, Auth (e-mail/senha), RLS, RPCs, Edge Function (Deno) |
| IA | Edge Function `interpret` → provedor configurável (Anthropic) ou adaptador **demo** determinístico; saída validada com zod |
| Offline | IndexedDB (cache de leitura + fila de operações "outbox") |
| Testes | Vitest (unitários), `node:test` + Postgres real (banco/RLS), Playwright (E2E/PWA/CSP) |

## Arquitetura

```
Navegador (PWA)                                   Supabase
┌──────────────────────────────┐   HTTPS   ┌────────────────────────────────────────────┐
│ UI Preact + signals          │──────────▶│ Auth (JWT do usuário)                      │
│  └ state.ts (overlay de      │  RPC/REST │ PostgREST → RPCs SECURITY INVOKER + RLS     │
│    pendências sobre snapshot)│           │ Edge Function `interpret` ─▶ provedor de IA │
│ lib/api.ts  (única camada    │           └────────────────────────────────────────────┘
│   que fala com o backend)    │
│ lib/outbox.ts (fila offline) │   Service worker: cache SÓ de estáticos (nunca API)
│ IndexedDB: snapshot + fila   │
└──────────────────────────────┘
```

Decisões-chave
- **Nenhum saldo é gravado.** Saldo = `opening_balance + receitas − despesas − aportes em metas` (calculado em `compute_balance`).
- **Dinheiro:** `NUMERIC(14,2)`, sempre positivo + `type` (`expense`/`income`); moeda BRL. `occurred_on` é `date` (fuso do usuário), `created_at` é `timestamptz`.
- **Idempotência:** `unique (user_id, idempotency_key)`; a RPC devolve o registro existente com `duplicate:true`. O id da operação offline **é** a chave.
- **Exclusão lógica** (`deleted_at`) com "Desfazer"; concorrência otimista na edição (`p_expected_updated_at`).
- **RLS `FORCE` em todas as tabelas**, privilégios por coluna, RPCs `SECURITY INVOKER` com `search_path=''`. Só `handle_new_user` e `delete_my_account` são `SECURITY DEFINER`. A `service_role` **não é usada** em lugar nenhum.
- **IA nunca grava sozinha.** Frontend → Edge Function → provedor → **zod** → proposta editável (Confirmar/Editar/Cancelar) → só então `create_transaction`. O valor do modelo precisa aparecer no texto do usuário; a data é decidida pelo servidor; categoria é validada contra as reais; perguntas não viram lançamentos; ambiguidade ("Gastei 20 reais") gera pergunta, não invenção.

## Estrutura

```
supabase/migrations/   0001 schema · 0002 RLS · 0003 funções/RPCs · 0004 grants
supabase/functions/    interpret/ (Deno.serve) · _shared/ (lógica pura, testada em Node e usada no Deno)
src/                   domain/ · lib/ · components/ · sheets/ · screens/
tests/unit | db | e2e  Vitest · Postgres real · Playwright
tools/gateway/         gateway DE TESTE (emula GoTrue/PostgREST/Edge sobre o Postgres real) — nunca vai a produção
scripts/               db-up.sh · gateway.sh · e2e-up.sh · make-icons.mjs
vercel.json            SPA rewrites + CSP/HSTS/nosniff/cache
```

## Variáveis de ambiente

Veja `.env.example`. Resumo:

| Variável | Onde | Observação |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | build do front | **Públicas** por desenho; a segurança vem do RLS |
| `GEMINI_API_KEY` ou `ANTHROPIC_API_KEY` | `supabase secrets set` | **Só servidor.** Provedor escolhido pela chave existente (Gemini tem preferência). Sem chave: modo demo (rotulado) |
| `GEMINI_MODEL` | secrets | padrão `gemini-3.1-flash-lite` — confirme o id vigente |
| `AI_MODE` | secrets | `demo`, `anthropic` ou `off`. Pedir `anthropic` sem chave **desliga** (não finge IA) |
| `ANTHROPIC_MODEL` | secrets | padrão `claude-haiku-4-5` — **confirme o id vigente na documentação do provedor** |
| `ALLOWED_ORIGIN` | secrets | origem exata do app (CORS da função) |
| `AI_TIMEOUT_MS` | secrets | padrão 8000 |

## Mascote da assistente
O acesso ao assistente é a mascote oficial (arte do Gemini fornecida pelo dono): estados, motion, limites e arquivos complementares em [`docs/MASCOT.md`](docs/MASCOT.md).

## Rodando localmente

```bash
npm ci
npm run typecheck && npm test            # unitários
scripts/db-up.sh reset && npm run test:db # banco/RLS em Postgres 16 descartável (porta 54329)
scripts/e2e-up.sh && npm run test:e2e     # sobe Postgres+gateway de teste, faz build de produção, vite preview :4173, roda Playwright
```

Para desenvolvimento contra um Supabase real: copie `.env.example` para `.env`, preencha as duas variáveis públicas e rode `npm run dev`.
Os testes E2E exigem Chromium (`PW_CHROMIUM` aponta o executável; padrão `/opt/pw-browsers/chromium`).

## Banco de dados e migrações

Quatro migrações versionadas em `supabase/migrations/`, aplicáveis em ambiente limpo (`scripts/db-up.sh reset` faz exatamente isso e os testes rodam em cima).
Em produção: `supabase link --project-ref <ref>` → `supabase db push`. Fluxo completo em [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Fluxos

- **Auth:** cadastro, login, logout, recuperação de senha (link por e-mail → "Nova senha"), expiração de sessão (volta ao login com aviso; pendências do aparelho ficam guardadas), rotas protegidas. Sessão em `localStorage` (padrão do supabase-js — veja limitações).
- **Offline:** só **criação** de lançamentos funciona offline. Vai para a outbox no IndexedDB *antes* de qualquer envio, aparece como "Pendente de sincronização", sincroniza em primeiro plano ao voltar a conexão (e por botão), com backoff. Edição/exclusão/orçamento/metas exigem conexão (avisado na UI). Estados visíveis: Offline · Sincronizando · Pendente · Falha ao sincronizar · Sincronizado · Sessão expirada.
- **Troca de conta:** pendências pertencem ao `user_id` que as criou; nunca são enviadas por outra conta. Logout com pendências pede confirmação; login de outra conta limpa os snapshots anteriores.
- **Privacidade:** exportar dados (JSON) e excluir conta (digitar `EXCLUIR`) no Perfil; limpar cache local.

## PWA

- Manifest (`name`, `short_name`, `start_url`, `scope`, `display: standalone`, ícones 192/512 + **maskable**) gerado a partir da identidade do app (preto `#10110F`, lima `#D5FF40`).
- Service worker: precache de **estáticos apenas**; API (outra origem) nunca é cacheada — verificado por teste.
- Atualização segura: `registerType: 'prompt'`; o app **nunca** recarrega sozinho e adia a atualização enquanto houver pendências.
- **Instalar no Android/Chrome:** menu ⋮ → *Instalar app* (ou o botão "Instalar" do Perfil, quando o navegador oferece).
- **Instalar no iPhone/iPad:** abra no **Safari** → *Compartilhar* → *Adicionar à Tela de Início*. (O Perfil mostra essas instruções.)

## Testes (o que cada camada prova — e o que não prova)

| Suíte | Qtde | Prova |
|---|---|---|
| Vitest | 102 | dinheiro/datas, interpretação, contrato e handler da IA (provedor simulado), insights, outbox |
| Banco (`test:db`) | 16 | RLS com 2 usuários, idempotência, saldo, orçamento, metas, validações, exclusão de conta |
| Playwright | 17 | fluxo completo em Chromium móvel (Pixel 7), offline, resposta perdida sem duplicar, isolamento via API direta, sessão expirada, recuperação de senha, SW/manifest, sob a CSP de produção |

Limites: veja [`docs/SECURITY.md`](docs/SECURITY.md). Em resumo: os E2E usam um **gateway de teste**, não o Supabase real; nunca foram rodados em iOS/Android reais; o provedor de IA real nunca foi chamado.

## Deploy, rollback

[`docs/DEPLOY.md`](docs/DEPLOY.md) — passo a passo exato (Supabase, função, secrets, Auth, Vercel/HTTPS, verificação pós-deploy, rollback).

## Limitações conhecidas

- Sessão (token) no `localStorage`: exposta a XSS; mitigada por CSP estrita, sem HTML dinâmico e sem scripts de terceiros. Não há cookie httpOnly sem um servidor próprio.
- Sem Background Sync: a fila só sincroniza com o app aberto.
- Só criação é offline; leituras offline usam o último snapshot (saldo, resumo, recentes). Lista completa de movimentações exige rede.
- Não há multi-moeda; fuso por usuário.
- Backups: dependem do plano do Supabase (PITR/backups diários variam por plano — confirme no painel; não assumimos). O export JSON do Perfil é o backup do próprio usuário.
- E-mail de recuperação usa o SMTP padrão do Supabase (limitado em volume); configure SMTP próprio para produção.
