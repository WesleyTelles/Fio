-- Funções de negócio. Todas SECURITY INVOKER: o RLS do chamador sempre vale.
-- Erros usam códigos estáveis (E_*) sem detalhes internos; o cliente traduz.

create function public._uid() returns uuid
language plpgsql stable set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'E_NOT_AUTHENTICATED'; end if;
  return u;
end $$;

-- Saldo = saldo inicial + receitas − despesas − (depósitos − retiradas de metas que contam no saldo)
create function public.compute_balance(p_as_of date) returns numeric
language sql stable set search_path = '' as $$
  select
    coalesce((select opening_balance from public.profiles where user_id = public._uid()), 0)
    + coalesce((select sum(case type when 'income' then amount else -amount end)
                from public.transactions
                where user_id = public._uid() and deleted_at is null and occurred_on <= p_as_of), 0)
    + coalesce((select sum(case kind when 'withdraw' then amount else -amount end)
                from public.goal_contributions
                where user_id = public._uid() and counts_in_balance and occurred_on <= p_as_of), 0)
$$;

-- ----------------------------------------------------------- movimentações
create function public.create_transaction(
  p_key uuid, p_type public.tx_type, p_amount numeric, p_description text,
  p_category_id uuid, p_date date, p_source public.tx_source default 'manual', p_ai_meta jsonb default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare u uuid := public._uid(); r public.transactions%rowtype; dup boolean := false;
begin
  if p_key is null then raise exception 'E_VALIDATION:idempotency_key'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'E_VALIDATION:amount'; end if;
  if p_description is null or char_length(btrim(p_description)) = 0 then raise exception 'E_VALIDATION:description'; end if;
  if p_date is null or p_date > current_date + 366 then raise exception 'E_VALIDATION:date'; end if;

  insert into public.transactions (user_id, type, amount, description, category_id, occurred_on, source, idempotency_key, ai_meta)
  values (u, p_type, p_amount, left(btrim(p_description), 120), p_category_id, p_date, p_source, p_key, p_ai_meta)
  on conflict (user_id, idempotency_key) do nothing
  returning * into r;

  if not found then   -- reenvio da mesma operação: devolve o registro original
    select * into r from public.transactions where user_id = u and idempotency_key = p_key;
    dup := true;
  end if;
  return to_jsonb(r) || jsonb_build_object('duplicate', dup);
end $$;

create function public.update_transaction(
  p_id uuid, p_type public.tx_type, p_amount numeric, p_description text,
  p_category_id uuid, p_date date, p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare u uuid := public._uid(); r public.transactions%rowtype;
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'E_VALIDATION:amount'; end if;
  if p_description is null or char_length(btrim(p_description)) = 0 then raise exception 'E_VALIDATION:description'; end if;
  if p_date is null or p_date > current_date + 366 then raise exception 'E_VALIDATION:date'; end if;
  select * into r from public.transactions where id = p_id and user_id = u and deleted_at is null for update;
  if not found then raise exception 'E_NOT_FOUND'; end if;
  -- concorrência otimista: dois dispositivos editando o mesmo lançamento
  if p_expected_updated_at is not null and r.updated_at <> p_expected_updated_at then raise exception 'E_CONFLICT'; end if;
  update public.transactions
     set type = p_type, amount = p_amount, description = p_description, category_id = p_category_id, occurred_on = p_date
   where id = p_id and user_id = u
   returning * into r;
  return to_jsonb(r);
end $$;

create function public.delete_transaction(p_id uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare u uuid := public._uid(); r public.transactions%rowtype;
begin
  update public.transactions set deleted_at = coalesce(deleted_at, now())
   where id = p_id and user_id = u returning * into r;
  if not found then raise exception 'E_NOT_FOUND'; end if;
  return to_jsonb(r);
end $$;

create function public.restore_transaction(p_id uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare u uuid := public._uid(); r public.transactions%rowtype;
begin
  update public.transactions set deleted_at = null
   where id = p_id and user_id = u and deleted_at is not null and deleted_at > now() - interval '1 day'
   returning * into r;
  if not found then raise exception 'E_NOT_FOUND'; end if;
  return to_jsonb(r);
end $$;

-- Histórico paginado por keyset (estável mesmo com inserções concorrentes).
create function public.list_transactions(
  p_from date default null, p_to date default null, p_category uuid default null,
  p_type text default null, p_q text default null, p_limit int default 30, p_cursor jsonb default null
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  u uuid := public._uid();
  lim int := least(greatest(coalesce(p_limit, 30), 1), 100);
  q text := nullif(btrim(coalesce(p_q, '')), '');
  cd date; cc timestamptz; cid uuid;
  items jsonb; n int; nxt jsonb := null;
begin
  if p_type is not null and p_type not in ('expense','income') then raise exception 'E_VALIDATION:type'; end if;
  if q is not null then q := '%' || replace(replace(replace(left(q, 60), '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  if p_cursor is not null then
    cd := (p_cursor ->> 'd')::date; cc := (p_cursor ->> 'c')::timestamptz; cid := (p_cursor ->> 'id')::uuid;
  end if;

  with page as (
    select t.* from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.user_id = u and t.deleted_at is null
      and (p_from is null or t.occurred_on >= p_from)
      and (p_to is null or t.occurred_on <= p_to)
      and (p_category is null or t.category_id = p_category)
      and (p_type is null or t.type::text = p_type)
      and (q is null or t.description ilike q or c.name ilike q)
      and (cd is null or (t.occurred_on, t.created_at, t.id) < (cd, cc, cid))
    order by t.occurred_on desc, t.created_at desc, t.id desc
    limit lim + 1
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p.occurred_on desc, p.created_at desc, p.id desc), '[]'::jsonb), count(*)
    into items, n from page p;

  if n > lim then
    items := items - lim;  -- remove o item extra (índice lim, base 0)
    nxt := jsonb_build_object('d', items -> (lim - 1) ->> 'occurred_on', 'c', items -> (lim - 1) ->> 'created_at', 'id', items -> (lim - 1) ->> 'id');
  end if;
  return jsonb_build_object('items', items, 'next_cursor', nxt);
end $$;

-- Resumo do período: mesma fonte para saldo, entradas, saídas e categorias.
create function public.get_summary(p_from date, p_to date, p_as_of date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare u uuid := public._uid(); inflow numeric; outflow numeric; cnt int; cats jsonb;
begin
  if p_from is null or p_to is null or p_as_of is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'E_VALIDATION:range';
  end if;
  select coalesce(sum(amount) filter (where type = 'income'), 0),
         coalesce(sum(amount) filter (where type = 'expense'), 0), count(*)
    into inflow, outflow, cnt
    from public.transactions
   where user_id = u and deleted_at is null and occurred_on between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object('category_id', category_id, 'type', type, 'amount', amt, 'count', n)
                            order by amt desc), '[]'::jsonb)
    into cats
    from (select category_id, type, sum(amount) amt, count(*) n
            from public.transactions
           where user_id = u and deleted_at is null and occurred_on between p_from and p_to
           group by category_id, type) s;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'as_of', p_as_of,
    'balance', public.compute_balance(p_as_of),
    'inflow', inflow, 'outflow', outflow, 'count', cnt, 'by_category', cats);
end $$;

-- ------------------------------------------------------------- orçamentos
create function public.upsert_budget(p_month date, p_category uuid, p_limit numeric) returns jsonb
language plpgsql set search_path = '' as $$
declare u uuid := public._uid(); r public.budgets%rowtype; m date := date_trunc('month', p_month)::date;
begin
  if p_limit is null or p_limit <= 0 or p_limit <> round(p_limit, 2) then raise exception 'E_VALIDATION:limit'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 11));
  update public.budgets set limit_amount = p_limit
   where user_id = u and month = m and category_id is not distinct from p_category returning * into r;
  if not found then
    insert into public.budgets (user_id, month, category_id, limit_amount) values (u, m, p_category, p_limit) returning * into r;
  end if;
  return to_jsonb(r);
end $$;

create function public.delete_budget(p_month date, p_category uuid) returns void
language plpgsql set search_path = '' as $$
begin
  delete from public.budgets
   where user_id = public._uid() and month = date_trunc('month', p_month)::date and category_id is not distinct from p_category;
end $$;

-- limite x usado por categoria no mês (usado = soma das despesas válidas)
create function public.get_budget_status(p_month date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare u uuid := public._uid(); m date := date_trunc('month', p_month)::date; res jsonb; tot_limit numeric; tot_spent numeric;
begin
  select limit_amount into tot_limit from public.budgets where user_id = u and month = m and category_id is null;
  select coalesce(sum(amount), 0) into tot_spent from public.transactions
   where user_id = u and deleted_at is null and type = 'expense' and occurred_on >= m and occurred_on < (m + interval '1 month')::date;

  select coalesce(jsonb_agg(jsonb_build_object('category_id', cid, 'limit', lim, 'spent', coalesce(sp, 0)) order by coalesce(sp, 0) desc), '[]'::jsonb)
    into res
    from (
      select coalesce(b.category_id, s.category_id) cid, b.limit_amount lim, s.sp
        from (select category_id, limit_amount from public.budgets where user_id = u and month = m and category_id is not null) b
        full join (select category_id, sum(amount) sp from public.transactions
                    where user_id = u and deleted_at is null and type = 'expense'
                      and occurred_on >= m and occurred_on < (m + interval '1 month')::date
                    group by category_id) s on s.category_id = b.category_id
    ) x;
  return jsonb_build_object('month', m, 'total_limit', tot_limit, 'total_spent', tot_spent, 'categories', res);
end $$;

-- ------------------------------------------------------------------ metas
create function public.goal_contrib_validate() returns trigger
language plpgsql set search_path = '' as $$
declare saved numeric; bal numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 7));
  if new.kind = 'withdraw' then
    select coalesce(sum(case kind when 'deposit' then amount else -amount end), 0) into saved
      from public.goal_contributions where goal_id = new.goal_id and user_id = new.user_id;
    if new.amount > saved then raise exception 'E_INSUFFICIENT_FUNDS'; end if;
  elsif new.counts_in_balance then
    bal := public.compute_balance(new.occurred_on);
    if new.amount > bal then raise exception 'E_INSUFFICIENT_BALANCE'; end if;
  end if;
  return new;
end $$;
create trigger goal_contrib_validate before insert on public.goal_contributions
  for each row execute function public.goal_contrib_validate();

create function public.create_goal(
  p_key uuid, p_name text, p_target numeric, p_deadline date, p_icon text, p_initial numeric, p_today date
) returns jsonb
language plpgsql set search_path = '' as $$
declare u uuid := public._uid(); g public.goals%rowtype;
begin
  if p_target is null or p_target <= 0 or p_target <> round(p_target, 2) then raise exception 'E_VALIDATION:target'; end if;
  if p_deadline is null or p_deadline <= p_today then raise exception 'E_VALIDATION:deadline'; end if;
  if coalesce(p_initial, 0) < 0 or coalesce(p_initial, 0) <> round(coalesce(p_initial, 0), 2) then raise exception 'E_VALIDATION:initial'; end if;
  insert into public.goals (user_id, name, target_amount, deadline, icon)
  values (u, left(btrim(p_name), 60), p_target, p_deadline, coalesce(p_icon, 'target')) returning * into g;
  if coalesce(p_initial, 0) > 0 then
    insert into public.goal_contributions (user_id, goal_id, kind, amount, occurred_on, counts_in_balance, idempotency_key)
    values (u, g.id, 'deposit', p_initial, p_today, false, p_key);
  end if;
  return to_jsonb(g);
end $$;

create function public.goal_move(p_key uuid, p_goal uuid, p_kind text, p_amount numeric, p_date date) returns jsonb
language plpgsql set search_path = '' as $$
declare u uuid := public._uid(); r public.goal_contributions%rowtype; dup boolean := false;
begin
  if p_kind not in ('deposit','withdraw') then raise exception 'E_VALIDATION:kind'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'E_VALIDATION:amount'; end if;
  if not exists (select 1 from public.goals where id = p_goal and user_id = u) then raise exception 'E_NOT_FOUND'; end if;
  insert into public.goal_contributions (user_id, goal_id, kind, amount, occurred_on, idempotency_key)
  values (u, p_goal, p_kind, p_amount, p_date, p_key)
  on conflict (user_id, idempotency_key) do nothing returning * into r;
  if not found then
    select * into r from public.goal_contributions where user_id = u and idempotency_key = p_key;
    dup := true;
  end if;
  return to_jsonb(r) || jsonb_build_object('duplicate', dup);
end $$;

create function public.list_goals() returns jsonb
language plpgsql stable set search_path = '' as $$
declare u uuid := public._uid();
begin
  return coalesce((
    select jsonb_agg(to_jsonb(g) || jsonb_build_object(
             'saved', coalesce(s.saved, 0), 'last_move_on', s.last_on, 'first_move_on', s.first_on) order by g.deadline, g.created_at)
      from public.goals g
      left join (select goal_id, sum(case kind when 'deposit' then amount else -amount end) saved,
                        max(occurred_on) last_on, min(occurred_on) first_on
                   from public.goal_contributions where user_id = u group by goal_id) s on s.goal_id = g.id
     where g.user_id = u), '[]'::jsonb);
end $$;

create function public.list_goal_moves(p_goal uuid, p_limit int default 20) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from (
    select id, kind, amount, occurred_on, counts_in_balance, created_at from public.goal_contributions
     where user_id = public._uid() and goal_id = p_goal
     order by occurred_on desc, created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) m
$$;

-- --------------------------------------------------- cota de IA (custos)
create function public.ai_take_quota(p_per_minute int default 8, p_per_day int default 200) returns jsonb
language plpgsql set search_path = '' as $$
declare u uuid := public._uid(); a int; b int; oldest timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(u::text, 13));
  delete from public.ai_calls where user_id = u and created_at < now() - interval '2 days';
  select count(*) into a from public.ai_calls where user_id = u and created_at > now() - interval '1 minute';
  select count(*) into b from public.ai_calls where user_id = u and created_at > now() - interval '1 day';
  if a >= p_per_minute then
    select min(created_at) into oldest from public.ai_calls where user_id = u and created_at > now() - interval '1 minute';
    return jsonb_build_object('allowed', false, 'reason', 'minute', 'retry_after', greatest(1, ceil(extract(epoch from (oldest + interval '1 minute' - now())))::int));
  end if;
  if b >= p_per_day then return jsonb_build_object('allowed', false, 'reason', 'day', 'retry_after', 3600); end if;
  insert into public.ai_calls (user_id) values (u);
  return jsonb_build_object('allowed', true, 'remaining_day', p_per_day - b - 1);
end $$;

-- ------------------------------------------------ exportação e exclusão
create function public.export_my_data() returns jsonb
language plpgsql stable set search_path = '' as $$
declare u uuid := public._uid();
begin
  return jsonb_build_object(
    'exported_at', now(), 'currency', 'BRL',
    'profile', (select to_jsonb(p) from public.profiles p where p.user_id = u),
    'categories', coalesce((select jsonb_agg(to_jsonb(c)) from public.categories c where c.user_id = u), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(to_jsonb(t) order by t.occurred_on, t.created_at) from public.transactions t where t.user_id = u), '[]'::jsonb),
    'budgets', coalesce((select jsonb_agg(to_jsonb(b)) from public.budgets b where b.user_id = u), '[]'::jsonb),
    'goals', coalesce((select jsonb_agg(to_jsonb(g)) from public.goals g where g.user_id = u), '[]'::jsonb),
    'goal_contributions', coalesce((select jsonb_agg(to_jsonb(x)) from public.goal_contributions x where x.user_id = u), '[]'::jsonb));
end $$;

-- Exclusão definitiva da conta (LGPD). Único ponto SECURITY DEFINER do esquema:
-- só apaga o PRÓPRIO usuário (auth.uid()); o cascade remove todos os dados.
create function public.delete_my_account(p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'E_NOT_AUTHENTICATED'; end if;
  if p_confirm is distinct from 'EXCLUIR' then raise exception 'E_VALIDATION:confirm'; end if;
  delete from auth.users where id = u;
end $$;
