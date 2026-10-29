-- Fio — núcleo do esquema financeiro (PostgreSQL / Supabase)
-- Convenção monetária: valores SEMPRE positivos em NUMERIC(14,2), moeda BRL.
-- O sinal vem do tipo: 'expense' sai do saldo, 'income' entra.
-- Datas: occurred_on é a data civil da movimentação (no fuso do usuário);
-- created_at é o instante (timestamptz) em que o sistema registrou.

create type public.tx_type   as enum ('expense', 'income');
create type public.tx_source as enum ('manual', 'ai');

-- ---------------------------------------------------------------- perfis
create table public.profiles (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  display_name    text not null default 'Você' check (char_length(btrim(display_name)) between 1 and 60),
  timezone        text not null default 'America/Sao_Paulo',
  opening_balance numeric(14,2) not null default 0 check (abs(opening_balance) < 1000000000),
  prefs           jsonb not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object' and pg_column_size(prefs) < 4096),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create function public.profiles_validate() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'E_VALIDATION:timezone';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end $$;
create trigger profiles_validate before insert or update on public.profiles
  for each row execute function public.profiles_validate();

-- ------------------------------------------------------------ categorias
-- user_id NULL  => categoria padrão (somente leitura para todos)
-- user_id = X   => categoria personalizada do usuário X
-- Categorias personalizadas são arquivadas (archived_at), nunca apagadas
-- quando já usadas: a FK em transactions é RESTRICT e preserva o histórico.
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete cascade,
  slug        text check (slug ~ '^[a-z0-9-]{2,30}$'),
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  kind        public.tx_type not null,
  color       text not null default '#6F7166' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon        text not null default 'dots',
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  check ((user_id is null) = (slug is not null))
);
create unique index categories_default_slug_uq on public.categories (slug) where user_id is null;
create unique index categories_user_name_uq on public.categories (user_id, lower(btrim(name)), kind)
  where user_id is not null and archived_at is null;
create index categories_user_idx on public.categories (user_id);

insert into public.categories (slug, name, kind, color, icon) values
  ('alimentacao', 'Alimentação', 'expense', '#D5FF40', 'food'),
  ('transporte',  'Transporte',  'expense', '#C0C2B8', 'car'),
  ('moradia',     'Moradia',     'expense', '#FFFFFF', 'home'),
  ('saude',       'Saúde',       'expense', '#A9C93A', 'heart'),
  ('educacao',    'Educação',    'expense', '#E6E8DC', 'book'),
  ('lazer',       'Lazer',       'expense', '#8A8D80', 'ticket'),
  ('compras',     'Compras',     'expense', '#B5B8AA', 'bag'),
  ('assinaturas', 'Assinaturas', 'expense', '#7D8F2B', 'repeat'),
  ('outros',      'Outros',      'expense', '#62645A', 'dots'),
  ('salario',     'Salário',     'income',  '#D5FF40', 'down'),
  ('renda-extra', 'Renda extra', 'income',  '#A9C93A', 'down'),
  ('outras-receitas', 'Outras receitas', 'income', '#8A8D80', 'down');

-- ---------------------------------------------------------- movimentações
create table public.transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type            public.tx_type not null,
  amount          numeric(14,2) not null check (amount > 0 and amount < 1000000000),
  currency        char(3) not null default 'BRL' check (currency = 'BRL'),
  description     text not null check (char_length(btrim(description)) between 1 and 120),
  category_id     uuid not null references public.categories (id) on delete restrict,
  occurred_on     date not null check (occurred_on between date '2000-01-01' and date '2100-01-01'),
  source          public.tx_source not null default 'manual',
  idempotency_key uuid not null,
  -- auditoria mínima: nunca guarda a conversa, só modo/modelo/confiança
  ai_meta         jsonb check (ai_meta is null or (jsonb_typeof(ai_meta) = 'object' and pg_column_size(ai_meta) < 1024)),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint transactions_idem_uq unique (user_id, idempotency_key)
);
create index transactions_hist_idx on public.transactions (user_id, occurred_on desc, created_at desc, id desc)
  where deleted_at is null;
create index transactions_cat_idx on public.transactions (user_id, category_id, occurred_on)
  where deleted_at is null;

create function public.transactions_validate() returns trigger
language plpgsql set search_path = '' as $$
declare c public.categories%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.idempotency_key <> old.idempotency_key
       or new.created_at <> old.created_at or new.source <> old.source then
      raise exception 'E_VALIDATION:immutable';
    end if;
  end if;
  if tg_op = 'INSERT' or new.category_id is distinct from old.category_id or new.type is distinct from old.type then
    select * into c from public.categories where id = new.category_id;  -- respeita RLS do chamador
    if not found or (c.user_id is not null and c.user_id <> new.user_id) then
      raise exception 'E_VALIDATION:category';
    end if;
    if c.kind::text <> new.type::text then raise exception 'E_VALIDATION:category_kind'; end if;
    if c.archived_at is not null and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id) then
      raise exception 'E_VALIDATION:category_archived';
    end if;
  end if;
  new.description := pg_catalog.btrim(new.description);
  new.updated_at := pg_catalog.now();
  return new;
end $$;
create trigger transactions_validate before insert or update on public.transactions
  for each row execute function public.transactions_validate();

-- -------------------------------------------------------------- orçamentos
-- Só o LIMITE é armazenado. "Usado" e "disponível" são sempre calculados
-- a partir de transactions (sem totais duplicados para divergir).
-- category_id NULL => orçamento total do mês.
create table public.budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month        date not null check (month = date_trunc('month', month)::date),
  category_id  uuid references public.categories (id) on delete restrict,
  limit_amount numeric(14,2) not null check (limit_amount > 0 and limit_amount < 1000000000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index budgets_uq on public.budgets
  (user_id, month, (coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid)));

create function public.budgets_validate() returns trigger
language plpgsql set search_path = '' as $$
declare c public.categories%rowtype;
begin
  if new.category_id is not null then
    select * into c from public.categories where id = new.category_id;
    if not found or (c.user_id is not null and c.user_id <> new.user_id) or c.kind <> 'expense' then
      raise exception 'E_VALIDATION:category';
    end if;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end $$;
create trigger budgets_validate before insert or update on public.budgets
  for each row execute function public.budgets_validate();

-- ------------------------------------------------------------------ metas
create table public.goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  target_amount numeric(14,2) not null check (target_amount > 0 and target_amount < 1000000000),
  deadline      date not null,
  icon          text not null default 'target' check (icon in ('target','plane','shield','laptop','gift','home')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, user_id)
);
create index goals_user_idx on public.goals (user_id, deadline);

-- deposit/withdraw. counts_in_balance=false para o valor "que já tenho guardado"
-- informado na criação (dinheiro de fora do app, não altera o saldo).
create table public.goal_contributions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id          uuid not null,
  kind             text not null check (kind in ('deposit','withdraw')),
  amount           numeric(14,2) not null check (amount > 0 and amount < 1000000000),
  occurred_on      date not null check (occurred_on between date '2000-01-01' and date '2100-01-01'),
  counts_in_balance boolean not null default true,
  idempotency_key  uuid not null,
  created_at       timestamptz not null default now(),
  constraint goal_contrib_goal_fk foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade,
  constraint goal_contrib_idem_uq unique (user_id, idempotency_key)
);
create index goal_contrib_goal_idx on public.goal_contributions (user_id, goal_id, occurred_on desc, created_at desc);

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := pg_catalog.now(); return new; end $$;
create trigger goals_touch before update on public.goals
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------ cota de IA
-- Só guarda (usuário, instante). Nunca o texto da conversa.
create table public.ai_calls (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index ai_calls_user_idx on public.ai_calls (user_id, created_at desc);

-- ------------------------------------------- perfil automático no cadastro
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  nm := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), '');
  if nm is null then nm := nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''); end if;
  insert into public.profiles (user_id, display_name)
  values (new.id, left(coalesce(nm, 'Você'), 60))
  on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
