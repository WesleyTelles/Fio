import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, as, asAnon, newUser, uuid, cat, rpc, rejects } from './helpers.mjs';

let A, B, alim, sal, outros;
const D = '2026-10-21';
const mk = (u, amount, desc = 'Teste', category = alim, type = 'expense', date = D, key = uuid()) =>
  rpc(u, 'create_transaction', [key, type, amount, desc, category, date, 'manual', null]);

before(async () => {
  A = await newUser(); B = await newUser();
  alim = await cat('alimentacao'); sal = await cat('salario'); outros = await cat('outros');
});
after(async () => { await pool.end(); });

test('cadastro cria perfil automaticamente e isola perfis', async () => {
  const pa = await as(A, async (c) => (await c.query('select * from public.profiles')).rows);
  assert.equal(pa.length, 1); assert.equal(pa[0].user_id, A); assert.equal(pa[0].timezone, 'America/Sao_Paulo');
  const upd = await as(B, async (c) => (await c.query("update public.profiles set display_name='hack' where user_id=$1", [A])).rowCount);
  assert.equal(upd, 0, 'B não pode alterar o perfil de A');
  await rejects(as(A, (c) => c.query("update public.profiles set timezone='Marte/Olimpo'")), 'E_VALIDATION:timezone');
});

test('anon não acessa nada (tabelas e RPCs)', async () => {
  await rejects(asAnon((c) => c.query('select * from public.transactions')), 'permission denied');
  await rejects(asAnon((c) => c.query('select public.list_goals()')), 'permission denied');
  await rejects(asAnon((c) => c.query('select * from public.categories')), 'permission denied');
});

test('validação de valores no banco', async () => {
  await rejects(mk(A, 0), 'E_VALIDATION:amount');
  await rejects(mk(A, -5), 'E_VALIDATION:amount');
  await rejects(mk(A, 1.234), 'E_VALIDATION:amount');
  await rejects(mk(A, 5, '   '), 'E_VALIDATION:description');
  await rejects(mk(A, 5, 'x', alim, 'expense', '2099-01-01'), 'E_VALIDATION:date');
  await rejects(mk(A, 5, 'x', sal, 'expense'), 'E_VALIDATION:category_kind');
  await rejects(mk(A, 5, 'x', alim, 'income'), 'E_VALIDATION:category_kind');
  await rejects(mk(A, 5, 'x', uuid()), 'E_VALIDATION:category');
  await rejects(as(A, (c) => c.query(
    "insert into public.transactions (type,amount,description,category_id,occurred_on,idempotency_key) values ('expense',1e12,'x',$1,'2026-10-01',$2)", [alim, uuid()])));
  await rejects(rpc(null, 'list_goals'), 'E_NOT_AUTHENTICATED');
});

test('R$ 8,00 de coxinha: histórico, saídas, saldo e categoria', async () => {
  const U = await newUser();
  await as(U, (c) => c.query('update public.profiles set opening_balance = 100'));
  const tx = await mk(U, 8, 'Coxinha');
  assert.equal(Number(tx.amount), 8); assert.equal(tx.duplicate, false); assert.equal(tx.currency, 'BRL');
  const s = await rpc(U, 'get_summary', ['2026-10-01', '2026-10-31', D]);
  assert.equal(Number(s.balance), 92); assert.equal(Number(s.outflow), 8); assert.equal(Number(s.inflow), 0);
  assert.equal(s.by_category.length, 1); assert.equal(s.by_category[0].category_id, alim);
  await mk(U, 250, 'Freela', sal, 'income');
  const s2 = await rpc(U, 'get_summary', ['2026-10-01', '2026-10-31', D]);
  assert.equal(Number(s2.balance), 342); assert.equal(Number(s2.inflow), 250);
});

test('sem erro de ponto flutuante (0,1 + 0,2)', async () => {
  const U = await newUser();
  await mk(U, 0.1); await mk(U, 0.2);
  const s = await rpc(U, 'get_summary', ['2026-10-01', '2026-10-31', D]);
  assert.equal(Number(s.outflow), 0.3); // com float seria 0.30000000000000004
});

test('idempotência: mesma chave não duplica (sequencial e concorrente)', async () => {
  const U = await newUser(); const key = uuid();
  const r1 = await mk(U, 8, 'Coxinha', alim, 'expense', D, key);
  const r2 = await mk(U, 8, 'Coxinha', alim, 'expense', D, key);
  assert.equal(r1.id, r2.id); assert.equal(r1.duplicate, false); assert.equal(r2.duplicate, true);
  const key2 = uuid();
  const res = await Promise.all(Array.from({ length: 12 }, () => mk(U, 9.9, 'Paralelo', alim, 'expense', D, key2)));
  assert.equal(new Set(res.map((r) => r.id)).size, 1, 'uma única linha');
  assert.equal(res.filter((r) => !r.duplicate).length, 1);
  const n = (await pool.query("select count(*)::int n from public.transactions where user_id=$1", [U])).rows[0].n;
  assert.equal(n, 2);
});

test('isolamento: B não lê, edita, apaga nem infere dados de A', async () => {
  const U1 = await newUser(), U2 = await newUser();
  const tx = await mk(U1, 77.7, 'Segredo');
  assert.equal((await as(U2, async (c) => (await c.query('select * from public.transactions')).rows)).length, 0);
  assert.equal((await as(U2, async (c) => (await c.query('select * from public.transactions where id=$1', [tx.id])).rows)).length, 0);
  await rejects(rpc(U2, 'delete_transaction', [tx.id]), 'E_NOT_FOUND');
  await rejects(rpc(U2, 'update_transaction', [tx.id, 'expense', 1, 'hack', alim, D, null]), 'E_NOT_FOUND');
  assert.equal((await as(U2, async (c) => (await c.query("update public.transactions set description='x' where id=$1", [tx.id])).rowCount)), 0);
  await rejects(as(U2, (c) => c.query("update public.transactions set user_id=$1 where id=$2", [U2, tx.id])), 'permission denied');
  await rejects(as(U2, (c) => c.query(
    "insert into public.transactions (user_id,type,amount,description,category_id,occurred_on,idempotency_key) values ($1,'expense',1,'x',$2,'2026-10-01',$3)",
    [U1, alim, uuid()])), 'row-level security');
  const l = await rpc(U2, 'list_transactions', [null, null, null, null, 'Segredo', 30, null]);
  assert.equal(l.items.length, 0);
  const s = await rpc(U2, 'get_summary', ['2026-10-01', '2026-10-31', D]);
  assert.equal(Number(s.outflow), 0);
  assert.equal((await as(U1, async (c) => (await c.query('select * from public.transactions')).rows)).length, 1);
  // sem DELETE físico
  await rejects(as(U1, (c) => c.query('delete from public.transactions where id=$1', [tx.id])), 'permission denied');
});

test('categorias: padrão compartilhadas, personalizadas privadas e protegidas', async () => {
  const U1 = await newUser(), U2 = await newUser();
  const mine = await as(U1, async (c) => (await c.query(
    "insert into public.categories (user_id,name,kind) values (auth.uid(),'Pets','expense') returning id")).rows[0].id);
  const seen2 = await as(U2, async (c) => (await c.query('select id from public.categories where id=$1', [mine])).rows);
  assert.equal(seen2.length, 0);
  await rejects(mk(U2, 5, 'x', mine), 'E_VALIDATION:category');
  await mk(U1, 5, 'Ração', mine);
  await rejects(as(U2, (c) => c.query("insert into public.categories (user_id,name,kind) values ($1,'Falsa','expense')", [U1])), 'row-level security');
  await rejects(as(U1, (c) => c.query("insert into public.categories (user_id,slug,name,kind) values (auth.uid(),'xx','Falsa','expense')")), 'row-level security');
  assert.equal((await as(U1, async (c) => (await c.query("update public.categories set name='Hack' where slug='outros'")).rowCount)), 0);
  // histórico preservado: não apaga categoria em uso; arquivar mantém lançamentos
  await rejects(as(U1, (c) => c.query('delete from public.categories where id=$1', [mine])), 'violates foreign key');
  await as(U1, (c) => c.query('update public.categories set archived_at=now() where id=$1', [mine]));
  await rejects(mk(U1, 5, 'Nova ração', mine), 'E_VALIDATION:category_archived');
  const l = await rpc(U1, 'list_transactions', [null, null, mine, null, null, 30, null]);
  assert.equal(l.items.length, 1);
});

test('edição, conflito otimista, exclusão e restauração', async () => {
  const U = await newUser();
  const tx = await mk(U, 10, 'Original');
  const up = await rpc(U, 'update_transaction', [tx.id, 'expense', 12.5, 'Editado', outros, D, tx.updated_at]);
  assert.equal(Number(up.amount), 12.5); assert.equal(up.category_id, outros);
  await rejects(rpc(U, 'update_transaction', [tx.id, 'expense', 99, 'Velho', alim, D, tx.updated_at]), 'E_CONFLICT');
  await rejects(rpc(U, 'update_transaction', [tx.id, 'income', 99, 'x', outros, D, null]), 'E_VALIDATION:category_kind');
  await rpc(U, 'delete_transaction', [tx.id]);
  assert.equal(Number((await rpc(U, 'get_summary', ['2026-10-01', '2026-10-31', D])).outflow), 0);
  assert.equal((await rpc(U, 'list_transactions', [])).items.length, 0);
  await rpc(U, 'restore_transaction', [tx.id]);
  assert.equal(Number((await rpc(U, 'get_summary', ['2026-10-01', '2026-10-31', D])).outflow), 12.5);
});

test('histórico: ordenação estável, paginação por cursor, filtros e busca segura', async () => {
  const U = await newUser();
  for (let i = 1; i <= 25; i++) await mk(U, i, `Item ${i}`, i % 2 ? alim : outros, 'expense', i <= 10 ? '2026-10-05' : '2026-10-06');
  await mk(U, 3000, 'Salário 100% ok_', sal, 'income', '2026-10-01');
  const seen = []; let cursor = null;
  for (let guard = 0; guard < 10; guard++) {
    const r = await rpc(U, 'list_transactions', [null, null, null, null, null, 10, cursor]);
    seen.push(...r.items); cursor = r.next_cursor; if (!cursor) break;
  }
  assert.equal(seen.length, 26); assert.equal(new Set(seen.map((x) => x.id)).size, 26);
  const dates = seen.map((x) => x.occurred_on);
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.equal((await rpc(U, 'list_transactions', [null, null, alim, null, null, 100, null])).items.length, 13);
  assert.equal((await rpc(U, 'list_transactions', [null, null, null, 'income', null, 100, null])).items.length, 1);
  assert.equal((await rpc(U, 'list_transactions', ['2026-10-06', '2026-10-06', null, null, null, 100, null])).items.length, 15);
  assert.equal((await rpc(U, 'list_transactions', [null, null, null, null, '100%', 100, null])).items.length, 1);
  assert.equal((await rpc(U, 'list_transactions', [null, null, null, null, '%', 100, null])).items.length, 1, '% é literal');
  assert.equal((await rpc(U, 'list_transactions', [null, null, null, null, 'alimentação', 100, null])).items.length, 13, 'busca por categoria');
  await rejects(rpc(U, 'list_transactions', [null, null, null, 'bogus', null, 10, null]), 'E_VALIDATION:type');
});

test('orçamento: limite armazenado, usado calculado, isolado por usuário', async () => {
  const U = await newUser(), V = await newUser();
  await rpc(U, 'upsert_budget', ['2026-10-17', alim, 450]);
  await rpc(U, 'upsert_budget', ['2026-10-01', alim, 500]);
  await rpc(U, 'upsert_budget', ['2026-10-01', null, 2000]);
  await rpc(U, 'upsert_budget', ['2026-10-01', null, 2100]);
  assert.equal((await pool.query('select count(*)::int n from public.budgets where user_id=$1', [U])).rows[0].n, 2);
  await mk(U, 322.8, 'Mercado'); await mk(U, 50, 'Cinema', await cat('lazer'));
  const st = await rpc(U, 'get_budget_status', ['2026-10-10']);
  assert.equal(Number(st.total_limit), 2100); assert.equal(Number(st.total_spent), 372.8);
  const a = st.categories.find((c) => c.category_id === alim);
  assert.equal(Number(a.limit), 500); assert.equal(Number(a.spent), 322.8);
  assert.equal(st.categories.length, 2);
  await mk(U, 10, 'Salgado'); // recalcula
  assert.equal(Number((await rpc(U, 'get_budget_status', ['2026-10-10'])).categories.find((c) => c.category_id === alim).spent), 332.8);
  const sv = await rpc(V, 'get_budget_status', ['2026-10-10']);
  assert.equal(sv.total_limit, null); assert.equal(sv.categories.length, 0);
  await rejects(rpc(U, 'upsert_budget', ['2026-10-01', sal, 100]), 'E_VALIDATION:category');
  await rejects(rpc(U, 'upsert_budget', ['2026-10-01', alim, 0]), 'E_VALIDATION:limit');
  await rpc(U, 'delete_budget', ['2026-10-01', null]);
  assert.equal((await rpc(U, 'get_budget_status', ['2026-10-10'])).total_limit, null);
});

test('metas: saldo inicial não mexe no saldo; depósito/retirada; limites; idempotência; isolamento', async () => {
  const U = await newUser(), V = await newUser();
  await mk(U, 1000, 'Salário', sal, 'income');
  const bal = async () => Number((await rpc(U, 'get_summary', ['2026-10-01', '2026-10-31', D])).balance);
  assert.equal(await bal(), 1000);
  const g = await rpc(U, 'create_goal', [uuid(), 'Viagem', 3000, '2026-12-20', 'plane', 400, D]);
  assert.equal(await bal(), 1000, 'valor inicial vem de fora do app');
  const k = uuid();
  await rpc(U, 'goal_move', [k, g.id, 'deposit', 200, D]);
  const dup = await rpc(U, 'goal_move', [k, g.id, 'deposit', 200, D]);
  assert.equal(dup.duplicate, true); assert.equal(await bal(), 800);
  let goals = await rpc(U, 'list_goals'); assert.equal(Number(goals[0].saved), 600);
  await rejects(rpc(U, 'goal_move', [uuid(), g.id, 'deposit', 800.01, D]), 'E_INSUFFICIENT_BALANCE');
  await rejects(rpc(U, 'goal_move', [uuid(), g.id, 'withdraw', 600.01, D]), 'E_INSUFFICIENT_FUNDS');
  await rpc(U, 'goal_move', [uuid(), g.id, 'withdraw', 100, D]);
  assert.equal(await bal(), 900);
  await rejects(as(U, (c) => c.query(
    "insert into public.goal_contributions (goal_id,kind,amount,occurred_on,idempotency_key) values ($1,'deposit',99999,$2,$3)", [g.id, D, uuid()])), 'E_INSUFFICIENT_BALANCE');
  await rejects(rpc(V, 'goal_move', [uuid(), g.id, 'deposit', 1, D]), 'E_NOT_FOUND');
  assert.equal((await rpc(V, 'list_goals')).length, 0);
  assert.equal((await rpc(V, 'list_goal_moves', [g.id, 20])).length, 0);
  await rejects(rpc(U, 'create_goal', [uuid(), 'x', 100, '2020-01-01', 'target', 0, D]), 'E_VALIDATION:deadline');
  await rejects(as(U, (c) => c.query("insert into public.goals (name,target_amount,deadline,icon) values ('x',1,'2027-01-01','virus')")));
  await as(U, (c) => c.query('delete from public.goals where id=$1', [g.id]));
  assert.equal(await bal(), 1000, 'excluir a meta devolve o guardado ao saldo (derivado)');
});

test('depósitos concorrentes não estouram o saldo (lock por usuário)', async () => {
  const U = await newUser();
  await mk(U, 100, 'Entrada', sal, 'income');
  const g = await rpc(U, 'create_goal', [uuid(), 'Meta', 5000, '2026-12-31', 'target', 0, D]);
  const res = await Promise.allSettled(Array.from({ length: 6 }, () => rpc(U, 'goal_move', [uuid(), g.id, 'deposit', 30, D])));
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 3);
  const s = await rpc(U, 'get_summary', ['2026-10-01', '2026-10-31', D]);
  assert.equal(Number(s.balance), 10);
});

test('cota de IA: limite por minuto, por usuário, sem guardar conteúdo', async () => {
  const U = await newUser(), V = await newUser();
  for (let i = 0; i < 3; i++) assert.equal((await rpc(U, 'ai_take_quota', [3, 100])).allowed, true);
  const d = await rpc(U, 'ai_take_quota', [3, 100]);
  assert.equal(d.allowed, false); assert.equal(d.reason, 'minute'); assert.ok(d.retry_after >= 1);
  assert.equal((await rpc(V, 'ai_take_quota', [3, 100])).allowed, true);
  const cols = (await pool.query("select column_name from information_schema.columns where table_name='ai_calls'")).rows.map((r) => r.column_name);
  assert.deepEqual(cols.sort(), ['created_at', 'id', 'user_id']);
});

test('exportação só com dados próprios; exclusão da conta apaga tudo', async () => {
  const U = await newUser(), V = await newUser();
  await mk(U, 5, 'Meu'); await mk(V, 6, 'Dele');
  const ex = await rpc(U, 'export_my_data');
  assert.equal(ex.transactions.length, 1); assert.equal(ex.transactions[0].description, 'Meu');
  assert.equal(JSON.stringify(ex).includes(V), false);
  await rejects(rpc(U, 'delete_my_account', ['sim']), 'E_VALIDATION:confirm');
  await rpc(U, 'delete_my_account', ['EXCLUIR']);
  for (const t of ['transactions', 'profiles', 'budgets', 'goals', 'ai_calls'])
    assert.equal((await pool.query(`select count(*)::int n from public.${t} where user_id=$1`, [U])).rows[0].n, 0, t);
  assert.equal((await pool.query('select count(*)::int n from public.transactions where user_id=$1', [V])).rows[0].n, 1);
});

test('todas as tabelas públicas têm RLS ativo e nenhuma função insegura exposta', async () => {
  const t = (await pool.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and not relrowsecurity")).rows;
  assert.deepEqual(t, []);
  const defs = (await pool.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.prosecdef`)).rows.map((r) => r.proname).sort();
  assert.deepEqual(defs, ['delete_my_account', 'handle_new_user'], 'só estas funções são SECURITY DEFINER');
  const noSp = (await pool.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%'))`)).rows;
  assert.deepEqual(noSp, [], 'todas fixam search_path');
});
