import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { signup, uniq, manualTx } from './helpers';

// Proxy local que serve o MESMO build, mas com os cabeçalhos REAIS de vercel.json (trocando só o host do Supabase
// pelo gateway de teste). Confirma que o app inteiro funciona sob a CSP de produção, sem violações.
const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
const hdrs: Record<string, string> = {};
for (const h of cfg.headers.find((x: any) => x.source === '/(.*)').headers) hdrs[h.key.toLowerCase()] = h.value.replace('https://*.supabase.co', process.env.CSP_NEG ? 'http://localhost:1' : 'http://localhost:54321');
let srv: http.Server;
test.beforeAll(async () => {
  srv = http.createServer((req, res) => {
    const up = http.request({ host: 'localhost', port: 4173, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:4173' } }, (r) => { res.writeHead(r.statusCode ?? 200, { ...r.headers, ...hdrs }); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(up);
  });
  await new Promise<void>((ok) => srv.listen(4174, ok));
});
test.afterAll(() => new Promise<void>((ok) => srv.close(() => ok())));
test.use({ baseURL: 'http://localhost:4174' });

test('app funciona sob a CSP/headers de produção (vercel.json) sem violações', async ({ page }) => {
  const viol: string[] = [];
  page.on('console', (m) => { if (/content security policy|refused to/i.test(m.text())) viol.push(m.text()); });
  page.on('pageerror', (e) => viol.push(e.message));
  await signup(page, 'Csp', uniq('csp'));
  await manualTx(page, { amount: '9,99', desc: 'Sob CSP' });
  await page.goto('/assistente');
  await page.getByLabel('Mensagem para o assistente').fill('Gastei 8 reais com coxinha');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByTestId('draft')).toBeVisible();
  await page.goto('/');
  await expect(page.getByTestId('recent')).toContainText('Sob CSP');
  const sw = await page.evaluate(async () => { await navigator.serviceWorker.ready; return (await navigator.serviceWorker.getRegistration())?.active?.state; });
  expect(sw).toBe('activated');
  expect(viol).toEqual([]);
});
