-- PENDENTE no projeto Supabase "fio": rode no SQL Editor do painel (o conector exige aprovação para DELETE).
create function public.delete_my_account(p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'E_NOT_AUTHENTICATED'; end if;
  if p_confirm is distinct from 'EXCLUIR' then raise exception 'E_VALIDATION:confirm'; end if;
  delete from auth.users where id = u;
end $$;
revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;
