// GATEWAY DE TESTE — NÃO É PARA PRODUÇÃO.
// Implementa o subconjunto da API do Supabase (GoTrue + PostgREST + Edge Function) que o app usa,
// em cima de um Postgres REAL com as migrações reais e RLS ativo. Serve para testar o app de ponta a ponta
// sem acesso à nuvem do Supabase. Em produção o app fala com o Supabase de verdade.
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import { SignJWT, jwtVerify } from 'jose';
import { handleInterpret } from '../../supabase/functions/_shared/handler.ts';

const PORT = Number(process.env.GATEWAY_PORT || 54321);
const PGPORT = Number(process.env.FIO_PG_PORT || 54329);
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'test-only-secret-test-only-secret-1234');
const ACCESS_TTL = Number(process.env.ACCESS_TTL || 3600);
const APP_URL = process.env.APP_URL || 'http://localhost:4173';
const pool = new pg.Pool({ host: '127.0.0.1', port: PGPORT, user: 'postgres', database: 'fio_test', max: 20 });
await pool.query('create extension if not exists pgcrypto');

const refreshTokens = new Map();   // token -> userId
const recoveries = new Map();      // token -> email
const outbox = [];                 // e-mails "enviados" (para os testes lerem o link)

const sign = (claims, ttl) => new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${ttl}s`).sign(SECRET);
export const anonKey = await sign({ role: 'anon', iss: 'fio-test' }, 3600 * 24 * 365);
const userObj = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: u.raw_user_meta_data ?? {}, app_metadata: { provider: 'email' }, created_at: u.created_at });
async function session(u) {
  const access_token = await sign({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email }, ACCESS_TTL);
  const refresh_token = crypto.randomBytes(24).toString('hex');
  refreshTokens.set(refresh_token, u.id);
  return { access_token, token_type: 'bearer', expires_in: ACCESS_TTL, expires_at: Math.floor(Date.now() / 1000) + ACCESS_TTL, refresh_token, user: userObj(u) };
}
async function claimsFrom(req) {
  const h = req.headers.authorization || '';
  if (!h.toLowerCase().startsWith('bearer ')) return null;
  try { return (await jwtVerify(h.slice(7), SECRET, { algorithms: ['HS256'] })).payload; } catch { return null; }
}
const body = async (req) => { const c = []; for await (const x of req) c.push(x); const s = Buffer.concat(c).toString(); return s ? JSON.parse(s) : {}; };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': '*' };
const corsFor = (req) => ({ ...CORS, 'access-control-allow-headers': req?.headers?.['access-control-request-headers'] || 'authorization, apikey, content-type, x-client-info, prefer, accept' });
let curReq = null;
const send = (res, status, data, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...corsFor(curReq), ...extra }); res.end(data === undefined ? '' : JSON.stringify(data)); };

/** Executa como o PostgREST: papel + claims do JWT numa transação. */
async function withRole(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const role = claims?.role === 'authenticated' ? 'authenticated' : 'anon';
    await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? { role: 'anon' })]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}
const pgErr = (e) => {
  const status = e.code === '42501' ? 403 : e.code === '23505' ? 409 : e.code === 'PGRST' ? 406 : 400;
  return [status, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null }];
};

const ID = /^[a-z_][a-z0-9_]*$/;
function filters(params, args) {
  const where = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (!ID.test(k)) throw Object.assign(new Error('bad column'), { code: 'PGRST' });
    let m;
    if ((m = /^eq\.(.*)$/.exec(v))) { args.push(m[1]); where.push(`"${k}"::text = $${args.length}`); }
    else if (v === 'is.null') where.push(`"${k}" is null`);
    else if (v === 'not.is.null') where.push(`"${k}" is not null`);
    else if ((m = /^in\.\((.*)\)$/.exec(v))) { args.push(m[1].split(',')); where.push(`"${k}"::text = any($${args.length})`); }
    else throw Object.assign(new Error('unsupported filter'), { code: 'PGRST' });
  }
  return where.length ? ' where ' + where.join(' and ') : '';
}
const colList = (s) => (!s || s === '*' ? '*' : s.split(',').map((c) => { if (!ID.test(c.trim())) throw Object.assign(new Error('bad select'), { code: 'PGRST' }); return `"${c.trim()}"`; }).join(','));

async function rest(req, res, url, claims) {
  const path = url.pathname.replace('/rest/v1/', '');
  const single = /pgrst\.object/.test(req.headers.accept || '');
  const wantRep = /return=representation/.test(req.headers.prefer || '');
  try {
    if (path.startsWith('rpc/')) {
      const fn = path.slice(4); if (!ID.test(fn)) return send(res, 404, { message: 'not found' });
      const b = req.method === 'GET' ? Object.fromEntries(url.searchParams) : await body(req);
      const keys = Object.keys(b); const args = keys.map((k) => (b[k] !== null && typeof b[k] === 'object' ? JSON.stringify(b[k]) : b[k]));
      for (const k of keys) if (!ID.test(k)) return send(res, 400, { message: 'bad arg' });
      const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
      const out = await withRole(claims, (c) => c.query(sql, args));
      return send(res, 200, out.rows[0]?.r ?? null);
    }
    const table = path; if (!ID.test(table)) return send(res, 404, { message: 'not found' });
    const p = url.searchParams, args = [];
    if (req.method === 'GET') {
      const where = filters(p, args);
      const ord = p.get('order') ? ' order by ' + p.get('order').split(',').map((o) => { const [c, d] = o.split('.'); if (!ID.test(c)) throw Object.assign(new Error('bad order'), { code: 'PGRST' }); return `"${c}" ${d === 'desc' ? 'desc' : 'asc'}`; }).join(',') : '';
      const lim = p.get('limit') ? ` limit ${Math.min(Number(p.get('limit')) || 100, 1000)}` : '';
      const r = await withRole(claims, (c) => c.query(`select ${colList(p.get('select'))} from public."${table}"${where}${ord}${lim}`, args));
      if (single) { if (r.rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null }); return send(res, 200, r.rows[0]); }
      return send(res, 200, r.rows);
    }
    if (req.method === 'POST') {
      const b = await body(req); const rows = Array.isArray(b) ? b : [b];
      const cols = [...new Set(rows.flatMap(Object.keys))]; for (const c of cols) if (!ID.test(c)) return send(res, 400, { message: 'bad column' });
      const vals = rows.map((r) => `(${cols.map((c) => { args.push(r[c] !== null && typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c]); return `$${args.length}`; }).join(',')})`).join(',');
      const r = await withRole(claims, (c) => c.query(`insert into public."${table}" (${cols.map((c) => `"${c}"`).join(',')}) values ${vals} returning *`, args));
      return send(res, 201, wantRep ? (single ? r.rows[0] : r.rows) : undefined);
    }
    if (req.method === 'PATCH') {
      const b = await body(req); const sets = Object.keys(b).map((k) => { if (!ID.test(k)) throw Object.assign(new Error('bad column'), { code: 'PGRST' }); args.push(b[k] !== null && typeof b[k] === 'object' ? JSON.stringify(b[k]) : b[k]); return `"${k}" = $${args.length}`; });
      const where = filters(p, args);
      const r = await withRole(claims, (c) => c.query(`update public."${table}" set ${sets.join(',')}${where} returning *`, args));
      return send(res, wantRep ? 200 : 204, wantRep ? (single ? r.rows[0] : r.rows) : undefined);
    }
    if (req.method === 'DELETE') {
      const where = filters(p, args);
      const r = await withRole(claims, (c) => c.query(`delete from public."${table}"${where} returning *`, args));
      return send(res, wantRep ? 200 : 204, wantRep ? r.rows : undefined);
    }
    return send(res, 405, { message: 'method' });
  } catch (e) { const [s, j] = pgErr(e); return send(res, s, j); }
}

async function auth(req, res, url) {
  const route = url.pathname.replace('/auth/v1', '');
  const gErr = (status, code, msg) => send(res, status, { code: status, error_code: code, msg, error: code, error_description: msg });
  if (route === '/signup' && req.method === 'POST') {
    const { email, password, data } = await body(req);
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return gErr(422, 'validation_failed', 'Unable to validate email address: invalid format');
    if (!password || password.length < 8) return gErr(422, 'weak_password', 'Password should be at least 8 characters.');
    try {
      const r = await pool.query("insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, crypt($2, gen_salt('bf')), $3) returning *", [email.toLowerCase(), password, JSON.stringify(data ?? {})]);
      return send(res, 200, await session(r.rows[0]));
    } catch (e) { if (e.code === '23505') return gErr(422, 'user_already_exists', 'User already registered'); throw e; }
  }
  if (route === '/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type'); const b = await body(req);
    if (grant === 'password') {
      const r = await pool.query('select * from auth.users where email = $1 and encrypted_password = crypt($2, encrypted_password)', [String(b.email || '').toLowerCase(), String(b.password || '')]);
      if (!r.rows[0]) return gErr(400, 'invalid_credentials', 'Invalid login credentials');
      return send(res, 200, await session(r.rows[0]));
    }
    if (grant === 'refresh_token') {
      const uid = refreshTokens.get(b.refresh_token);
      if (!uid) return gErr(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      refreshTokens.delete(b.refresh_token);
      const r = await pool.query('select * from auth.users where id = $1', [uid]);
      if (!r.rows[0]) return gErr(400, 'user_not_found', 'User not found');
      return send(res, 200, await session(r.rows[0]));
    }
  }
  if (route === '/logout') { return send(res, 204); }
  if (route === '/user') {
    const claims = await claimsFrom(req);
    if (!claims?.sub) return gErr(401, 'bad_jwt', 'invalid JWT');
    if (req.method === 'GET') { const r = await pool.query('select * from auth.users where id = $1', [claims.sub]); return r.rows[0] ? send(res, 200, userObj(r.rows[0])) : gErr(403, 'user_not_found', 'User from sub claim in JWT does not exist'); }
    if (req.method === 'PUT') {
      const b = await body(req);
      if (b.password) { if (b.password.length < 8) return gErr(422, 'weak_password', 'Password should be at least 8 characters.'); await pool.query("update auth.users set encrypted_password = crypt($1, gen_salt('bf')) where id = $2", [b.password, claims.sub]); }
      const r = await pool.query('select * from auth.users where id = $1', [claims.sub]); return send(res, 200, userObj(r.rows[0]));
    }
  }
  if (route === '/recover' && req.method === 'POST') {
    const { email } = await body(req);
    const r = await pool.query('select id from auth.users where email = $1', [String(email || '').toLowerCase()]);
    if (r.rows[0]) { const token = crypto.randomBytes(16).toString('hex'); recoveries.set(token, String(email).toLowerCase()); const redirect = url.searchParams.get('redirect_to') || APP_URL; outbox.push({ to: String(email).toLowerCase(), link: `http://localhost:${PORT}/auth/v1/verify?token=${token}&type=recovery&redirect_to=${encodeURIComponent(redirect)}` }); }
    return send(res, 200, {}); // mesma resposta exista ou não (não revela cadastros)
  }
  if (route === '/verify' && req.method === 'GET') {
    const email = recoveries.get(url.searchParams.get('token')); recoveries.delete(url.searchParams.get('token'));
    if (!email) { res.writeHead(302, { location: `${url.searchParams.get('redirect_to') || APP_URL}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired` }); return res.end(); }
    const u = (await pool.query('select * from auth.users where email = $1', [email])).rows[0];
    const s = await session(u);
    res.writeHead(302, { location: `${url.searchParams.get('redirect_to') || APP_URL}#access_token=${s.access_token}&expires_in=${s.expires_in}&refresh_token=${s.refresh_token}&token_type=bearer&type=recovery` }); return res.end();
  }
  return gErr(404, 'not_found', 'not found');
}

async function edge(req, res) {
  const asUser = (jwt) => jwtVerify(jwt, SECRET, { algorithms: ['HS256'] }).then((r) => r.payload);
  const webReq = new Request('http://gw/functions/v1/interpret', { method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(await (async () => { const c = []; for await (const x of req) c.push(x); return c; })()) });
  const out = await handleInterpret(webReq, {
    env: (k) => ({ ALLOWED_ORIGIN: '*', AI_MODE: process.env.AI_MODE, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY })[k],
    authenticate: async (jwt) => { const p = await asUser(jwt); return p.role === 'authenticated' ? p.sub : null; },
    takeQuota: async (jwt) => { const p = await asUser(jwt); return withRole(p, async (c) => (await c.query('select public.ai_take_quota($1, $2) as r', [Number(process.env.AI_PER_MIN || 8), 200])).rows[0].r); },
    loadCategories: async (jwt) => { const p = await asUser(jwt); return withRole(p, async (c) => (await c.query('select id, slug, name, kind from public.categories where archived_at is null')).rows.map((r) => ({ key: r.slug ?? r.id, name: r.name, kind: r.kind }))); },
  });
  res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(Buffer.from(await out.arrayBuffer()));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`); curReq = req;
  if (req.method === 'OPTIONS') { res.writeHead(204, corsFor(req)); return res.end(); }
  try {
    if (url.pathname === '/__test/anon-key') return send(res, 200, { anonKey });
    if (url.pathname === '/__test/outbox') return send(res, 200, outbox);
    if (url.pathname === '/__test/revoke') { refreshTokens.clear(); return send(res, 200, { ok: true }); }
    if (url.pathname.startsWith('/auth/v1/')) return await auth(req, res, url);
    if (url.pathname.startsWith('/functions/v1/interpret')) return await edge(req, res);
    if (url.pathname.startsWith('/rest/v1/')) {
      const claims = await claimsFrom(req);
      if (req.headers.authorization && !claims) return send(res, 401, { code: 'PGRST301', message: 'JWT expired' });
      return await rest(req, res, url, claims ?? { role: 'anon' });
    }
    send(res, 404, { message: 'not found' });
  } catch (e) { console.error('gateway error', e.message); send(res, 500, { message: 'gateway error' }); }
}).listen(PORT, () => console.log(`gateway de teste em http://localhost:${PORT} (anon key: GET /__test/anon-key)`));
