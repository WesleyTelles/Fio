# Deploy — passo a passo (nada aqui foi executado contra a nuvem nesta sessão)

Pré-requisitos: conta Supabase, conta Vercel (ou outra hospedagem estática com HTTPS), Node 20+, Supabase CLI (`npm i -D supabase` ou instalador oficial), um domínio **permanente** (não use URL de preview como endereço final).

## 1. Supabase (banco + auth)

1. Crie o projeto (região próxima do público, ex.: São Paulo). Guarde a senha do banco no seu gerenciador de senhas.
2. Na raiz do repositório:
   ```bash
   supabase login
   supabase link --project-ref <REF_DO_PROJETO>
   supabase db push          # aplica 0001..0004 em ordem
   ```
3. **Auth → Providers → Email:** habilite e-mail/senha; senha mínima **8**; decida sobre *Confirm email* (recomendado ligado em produção — o app já trata "confirme seu e-mail").
4. **Auth → URL Configuration:** *Site URL* = `https://SEU-DOMINIO`; em *Redirect URLs* adicione `https://SEU-DOMINIO` (o link de recuperação volta para a raiz do app).
5. **Auth → SMTP:** configure SMTP próprio (o padrão do Supabase é limitado e não serve para produção).
6. **Conferência pós-migração** (SQL Editor):
   ```sql
   select tablename, rowsecurity, forcerowsecurity from pg_tables t join pg_class c on c.relname=t.tablename
   where schemaname='public';            -- todas as tabelas com RLS e FORCE = true
   ```

## 2. Função de IA

```bash
supabase functions deploy interpret
supabase secrets set ALLOWED_ORIGIN=https://SEU-DOMINIO AI_MODE=anthropic ANTHROPIC_API_KEY=<chave> ANTHROPIC_MODEL=<id-do-modelo-vigente>
```
- Sem `ANTHROPIC_API_KEY`: use `AI_MODE=demo` (UI mostra "Modo demonstração") ou `AI_MODE=off` (assistente desativado; registro manual segue funcionando).
- Confirme o **id do modelo** na documentação do provedor antes de definir `ANTHROPIC_MODEL` (o padrão do código não foi verificado contra a API real).
- A cota (8/min, 200/dia por usuário) é aplicada no banco via `ai_take_quota`.

## 3. Front-end (Vercel)

1. Importe o repositório. Framework: *Other*. `vercel.json` já define build, rewrites de SPA e cabeçalhos.
2. Variáveis (Production): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (Project Settings → API → **anon/public**). **Nunca** coloque `service_role` aqui.
3. Domínio: adicione o domínio permanente; HTTPS é automático.
4. Ajuste a CSP se o seu Supabase não for `*.supabase.co` (campo `connect-src` do `vercel.json`).

## 4. Verificação pós-deploy (faça nesta ordem)

1. `https://SEU-DOMINIO/manifest.webmanifest` abre; DevTools → Application → Manifest sem erros; "Installability" ok.
2. Application → Service Workers: `sw.js` *activated*. Cache Storage: só arquivos estáticos.
3. Cadastro com e-mail real → entra. Registre um lançamento manual e um pelo assistente (confirmando).
4. Modo avião → registre → aparece "Pendente" → desligue o modo avião → vira "Sincronizado" (sem duplicar).
5. Recuperação de senha: o e-mail chega e o link abre "Nova senha".
6. Duas contas: a segunda **não** vê dados da primeira.
7. Android (Chrome): instalar e abrir em tela cheia. iPhone (Safari): Compartilhar → Adicionar à Tela de Início; abrir e testar offline.
8. `curl -sI https://SEU-DOMINIO | grep -i -E "content-security|strict-transport|nosniff"`.

## 5. Rollback

- **Front:** Vercel → Deployments → *Promote to Production* no deploy anterior. O SW novo só ativa quando o usuário aceitar a atualização; usuários na versão anterior continuam funcionando.
- **Função:** `supabase functions deploy interpret` a partir do commit anterior (`git checkout <sha> -- supabase/functions`).
- **Banco:** migrações são *forward-only*. Para desfazer, escreva uma migração nova (`0005_...`) — não edite as já aplicadas. Antes de qualquer migração destrutiva, faça backup (painel do Supabase → Database → Backups, conforme o plano; ou `supabase db dump`).

## 6. Backup e privacidade

- Confirme no painel quais backups/PITR o **seu plano** oferece; não presumimos. Agende `supabase db dump` se precisar de cópias próprias.
- Usuário pode exportar (JSON) e excluir a conta pelo Perfil (`delete_my_account` apaga perfil, categorias, lançamentos, orçamentos, metas e registros de IA).
- Revise e publique uma política de privacidade antes de abrir ao público (dados financeiros pessoais — LGPD). Este repositório não inclui texto jurídico.

## 7. O que continua dependendo de você

Projeto Supabase criado e `db push` executado · secrets definidos · SMTP · domínio · variáveis na Vercel · teste em celulares reais · política de privacidade.
