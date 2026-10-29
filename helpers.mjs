import pg from 'pg';
export const PORT = Number(process.env.FIO_PG_PORT || 54329);
export const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'fio_test', max: 20 });

/** Executa fn numa transação com o papel `authenticated` e o JWT do usuário (como o PostgREST faz). */
export async function as(userId, fn, { role = 'authenticated', commit = true } = {}) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(userId ? { sub: userId, role } : { role })]);
    const r = await fn(c);
    await c.query(commit ? 'commit' : 'rollback');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}
export const asAnon = (fn) => as(null, fn, { role: 'anon' });

export async function newUser(email) {
  const { rows } = await pool.query(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email || `u${Math.random().toString(36).slice(2)}@t.dev`, JSON.stringify({ name: 'Teste' })]);
  return rows[0].id;
}
export const uuid = () => crypto.randomUUID();
export async function cat(slug) { return (await pool.query('select id from public.categories where slug=$1', [slug])).rows[0].id; }
export async function rpc(userId, name, args = []) {
  const ph = args.map((_, i) => `$${i + 1}`).join(',');
  return as(userId, async (c) => (await c.query(`select public.${name}(${ph}) as r`, args)).rows[0].r);
}
export async function rejects(promise, code) {
  try { await promise; } catch (e) {
    if (code && !String(e.message).includes(code)) throw new Error(`esperava erro "${code}", veio "${e.message}"`);
    return e;
  }
  throw new Error(`esperava rejeição${code ? ` (${code})` : ''}, mas a operação foi aceita`);
}
