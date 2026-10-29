-- Execução de funções: nada para PUBLIC/anon; só usuários autenticados chamam as RPCs.
revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function
  public._uid(), public.compute_balance(date),
  public.create_transaction(uuid, public.tx_type, numeric, text, uuid, date, public.tx_source, jsonb),
  public.update_transaction(uuid, public.tx_type, numeric, text, uuid, date, timestamptz),
  public.delete_transaction(uuid), public.restore_transaction(uuid),
  public.list_transactions(date, date, uuid, text, text, int, jsonb),
  public.get_summary(date, date, date),
  public.upsert_budget(date, uuid, numeric), public.delete_budget(date, uuid), public.get_budget_status(date),
  public.create_goal(uuid, text, numeric, date, text, numeric, date),
  public.goal_move(uuid, uuid, text, numeric, date), public.list_goals(), public.list_goal_moves(uuid, int),
  public.ai_take_quota(int, int), public.export_my_data(), public.delete_my_account(text)
to authenticated;
-- Funções de gatilho (profiles_validate, transactions_validate, ...) não são chamáveis via API.
