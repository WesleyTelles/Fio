-- Evolução do saldo dia a dia (gráfico do início). Mesma regra de compute_balance:
-- saldo inicial + receitas − despesas − (depósitos − retiradas de metas que contam no saldo).
-- O primeiro ponto é o saldo no FIM do dia anterior a p_from (linha de base para calcular a variação do período).
create function public.get_balance_series(p_from date, p_to date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare u uuid := public._uid(); base numeric; res jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'E_VALIDATION:range';
  end if;
  base := public.compute_balance(p_from - 1);
  with days as (
    select (p_from - 1 + g)::date as day from generate_series(0, p_to - p_from + 1) g
  ), net as (
    select occurred_on as day, sum(case type when 'income' then amount else -amount end) as v
      from public.transactions
     where user_id = u and deleted_at is null and occurred_on between p_from and p_to group by occurred_on
    union all
    select occurred_on, sum(case kind when 'withdraw' then amount else -amount end)
      from public.goal_contributions
     where user_id = u and counts_in_balance and occurred_on between p_from and p_to group by occurred_on
  ), daily as (select day, sum(v) as v from net group by day)
  select coalesce(jsonb_agg(jsonb_build_object('d', x.day, 'balance', x.bal) order by x.day), '[]'::jsonb) into res
    from (select d.day, base + coalesce(sum(case when d.day > p_from - 1 then dl.v end) over (order by d.day), 0) as bal
            from days d left join daily dl on dl.day = d.day) x;
  return res;
end $$;

revoke all on function public.get_balance_series(date, date) from public, anon;
grant execute on function public.get_balance_series(date, date) to authenticated;
