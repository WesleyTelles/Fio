import { test, expect } from '@playwright/test';
import { signup, uniq, manualTx } from './helpers';

test('manifest, ícones e service worker', async ({ page, request }) => {
  await page.goto('/');
  const m = await (await request.get('http://localhost:4173/manifest.webmanifest')).json();
  expect(m).toMatchObject({ display: 'standalone', start_url: '/', scope: '/' });
  expect(m.name && m.short_name).toBeTruthy();
  expect(m.icons.some((i: any) => i.purpose?.includes('maskable'))).toBe(true);
  for (const i of m.icons) expect((await request.get('http://localhost:4173' + (i.src.startsWith('/') ? i.src : '/' + i.src))).ok()).toBe(true);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const sw = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state);
  expect(sw).toBe('activated');
});

test('cache do SW guarda só estáticos — nunca dados da API', async ({ page }) => {
  const email = uniq('sw'); await signup(page, 'Mel', email);
  await manualTx(page, { amount: '1,00', desc: 'Nao cachear' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  const urls = await page.evaluate(async () => { const o: string[] = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) o.push(r.url); return o; });
  expect(urls.length).toBeGreaterThan(5);
  expect(urls.filter((u) => /54321|\/rest\/v1|\/auth\/v1|\/functions\/v1/.test(u))).toEqual([]);
});

test('reabrir offline: shell carrega e mostra dados do último snapshot do usuário', async ({ page, context }) => {
  const email = uniq('ro'); await signup(page, 'Noa', email);
  await manualTx(page, { amount: '15,00', desc: 'Visivel offline' });
  await page.goto('/movimentacoes'); await expect(page.getByRole('button', { name: /Visivel offline/ })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Visivel offline/ })).toBeVisible(); // "atividade recente" vem do snapshot do usuário
  await expect(page.getByText(/dados salvos/i)).toBeVisible();                       // e o app avisa que pode estar desatualizado
  await page.goto('/movimentacoes');                                                  // lista completa exige rede: erro honesto, sem tela em branco
  await expect(page.getByRole('alert')).toContainText('Sem conexão');
  await page.goto('/orcamento'); // rota profunda offline (navigateFallback)
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
});

test('sem erros críticos de console nas telas principais', async ({ page }) => {
  const bad: string[] = [];
  page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) bad.push(m.text()); });
  await signup(page, 'Ola', uniq('cs'));
  for (const p of ['/', '/movimentacoes', '/orcamento', '/metas', '/insights', '/assistente', '/perfil']) { await page.goto(p); await page.waitForTimeout(400); }
  expect(bad).toEqual([]);
});
