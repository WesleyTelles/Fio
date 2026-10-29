-- Row Level Security: todas as tabelas com dados privados.
-- Regra de ouro: a identidade vem SEMPRE de auth.uid() (JWT validado), nunca do cliente.

alter table public.profiles           enable row level security;
alter table public.categories         enable row level security;
alter table public.transactions       enable row level security;
alter table public.budgets            enable row level security;
alter table public.goals              enable row level security;
alter table public.goal_contributions enable row level security;
alter table public.ai_calls           enable row level security;

alter table public.profiles           force row level security;
alter table public.categories         force row level security;
alter table public.transactions       force row level security;
alter table public.budgets            force row level security;
alter table public.goals              force row level security;
alter table public.goal_contributions force row level security;
alter table public.ai_calls           force row level security;

-- Nada para anon (visitante sem login).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- profiles
grant select, insert, update (display_name, timezone, opening_balance, prefs) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_insert on public.profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- sem DELETE: a exclusão da conta é feita por delete_my_account()

-- categories: padrão (user_id null) legível por todos; personalizadas só do dono
grant select, insert, update (name, color, icon, archived_at), delete on public.categories to authenticated;
create policy categories_select on public.categories for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy categories_insert on public.categories for insert to authenticated
  with check (user_id = (select auth.uid()) and slug is null);
create policy categories_update on public.categories for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy categories_delete on public.categories for delete to authenticated
  using (user_id = (select auth.uid()));

-- transactions: sem DELETE físico (exclusão = soft delete via UPDATE deleted_at)
grant select, insert, update (type, amount, description, category_id, occurred_on, deleted_at) on public.transactions to authenticated;
create policy transactions_select on public.transactions for select to authenticated using (user_id = (select auth.uid()));
create policy transactions_insert on public.transactions for insert to authenticated with check (user_id = (select auth.uid()));
create policy transactions_update on public.transactions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- budgets
grant select, insert, update (limit_amount), delete on public.budgets to authenticated;
create policy budgets_select on public.budgets for select to authenticated using (user_id = (select auth.uid()));
create policy budgets_insert on public.budgets for insert to authenticated with check (user_id = (select auth.uid()));
create policy budgets_update on public.budgets for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy budgets_delete on public.budgets for delete to authenticated using (user_id = (select auth.uid()));

-- goals
grant select, insert, update (name, target_amount, deadline, icon), delete on public.goals to authenticated;
create policy goals_select on public.goals for select to authenticated using (user_id = (select auth.uid()));
create policy goals_insert on public.goals for insert to authenticated with check (user_id = (select auth.uid()));
create policy goals_update on public.goals for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy goals_delete on public.goals for delete to authenticated using (user_id = (select auth.uid()));

-- goal_contributions: imutáveis (sem UPDATE/DELETE direto); somem em cascata com a meta
grant select, insert on public.goal_contributions to authenticated;
create policy gc_select on public.goal_contributions for select to authenticated using (user_id = (select auth.uid()));
create policy gc_insert on public.goal_contributions for insert to authenticated with check (user_id = (select auth.uid()));

-- ai_calls: o usuário só registra/consulta as próprias chamadas
grant select, insert, delete on public.ai_calls to authenticated;
create policy ai_calls_select on public.ai_calls for select to authenticated using (user_id = (select auth.uid()));
create policy ai_calls_insert on public.ai_calls for insert to authenticated with check (user_id = (select auth.uid()));
create policy ai_calls_delete on public.ai_calls for delete to authenticated using (user_id = (select auth.uid()));
