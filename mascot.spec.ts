import { test, expect, type Page } from '@playwright/test';
import { signup, uniq, txCount, manualTx } from './helpers';

const fab = (p: Page) => p.getByRole('button', { name: 'Abrir assistente financeiro' });
const headMood = (p: Page) => p.getByTestId('assistant-mascot');
const send = async (p: Page, t: string) => { await p.getByLabel('Mensagem para o assistente').fill(t); await p.getByRole('button', { name: 'Enviar', exact: true }).click(); };

test.describe('mascote da assistente', () => {
  test('substitui o botão antigo: imagem carregada, nome acessível, alvo ≥ 44px, abre o assistente existente', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await signup(page, 'Mia', uniq('mas'));
    const b = fab(page); await expect(b).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir assistente para registrar' })).toHaveCount(0);   // botão genérico antigo não existe mais
    const img = b.locator('img.mascot-img');
    await expect(img).toBeVisible();
    expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(192);          // arte original recortada, nítida em 3x
    const box = (await b.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    await b.focus(); await expect(b).toBeFocused();
    await b.press('Enter');                                                                              // teclado
    await expect(page).toHaveURL(/\/assistente$/);
    await expect(page.getByTestId('ai-mode')).toBeVisible();
    await expect(headMood(page)).toHaveAttribute('data-mood', 'idle');
    expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
  });

  test('aparelho modesto: sem movimento de repouso, mas o processamento continua sinalizado', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 }));
    await signup(page, 'Lua', uniq('lite'));
    expect(await fab(page).locator('.mascot').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    await expect(page.locator('html')).toHaveAttribute('data-lite', '');
    await expect(fab(page).locator('.mascot-halo')).toBeVisible();
  });

  test('repouso anima o corpo inteiro; movimento reduzido desliga o deslocamento mantendo o estado legível', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }));
    await signup(page, 'Noa', uniq('rm'));
    const anim = () => fab(page).locator('.mascot').evaluate((e) => getComputedStyle(e).animationName);
    expect(await anim()).toBe('mFloat');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(anim).toBe('none');
    await expect(fab(page).locator('.mascot-badge')).toBeVisible();                                      // selo de disponibilidade segue visível
  });

  test('processando só enquanto a IA responde de verdade; confirmar → aceno somente após o servidor gravar', async ({ page }) => {
    const email = uniq('mood'); await signup(page, 'Lia', email);
    let release: () => void = () => {}; const gate = new Promise<void>((r) => { release = r; });
    await page.route('**/functions/v1/interpret', async (route) => { if (route.request().method() === 'POST') await gate; await route.continue(); });
    await fab(page).click();
    await send(page, 'Gastei 8 reais com coxinha');
    await expect(headMood(page)).toHaveAttribute('data-mood', 'busy');                                   // IA ainda não respondeu
    await expect(page.getByTestId('draft')).toHaveCount(0);
    release();
    await expect(page.getByTestId('draft')).toBeVisible();
    await expect(headMood(page)).toHaveAttribute('data-mood', 'idle');                                   // proposta ≠ registro: sem comemorar
    expect(await txCount(email)).toBe(0);
    await page.getByTestId('draft').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('draft-done')).toBeVisible();
    expect(await txCount(email, 'Coxinha')).toBe(1);
    await expect(headMood(page)).toHaveAttribute('data-mood', 'happy');
    await expect(headMood(page)).toHaveAttribute('data-mood', 'idle', { timeout: 4000 });               // reação curta e discreta
  });

  test('cancelar não comemora; receita também passa pelo mesmo fluxo', async ({ page }) => {
    const email = uniq('canc'); await signup(page, 'Ivo', email);
    await page.goto('/assistente');
    await send(page, 'Recebi 250 reais de um freela');
    await page.getByTestId('draft').getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByText('Cancelado. Nada foi registrado.')).toBeVisible();
    await expect(headMood(page)).toHaveAttribute('data-mood', 'idle');
    expect(await txCount(email)).toBe(0);
    await send(page, 'Recebi 250 reais de um freela');
    await page.getByTestId('draft').last().getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('draft-done')).toBeVisible();
    await expect(headMood(page)).toHaveAttribute('data-mood', 'happy');
    expect(await txCount(email, 'Freela')).toBe(1);
  });

  test('offline: lançamento fica PENDENTE e a mascote não celebra', async ({ page, context }) => {
    const email = uniq('off'); await signup(page, 'Teo', email);
    await page.goto('/assistente');
    await send(page, 'Gastei 12 com uber');
    await expect(page.getByTestId('draft')).toBeVisible();
    await context.setOffline(true);
    await page.getByTestId('draft').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('draft-done')).toContainText(/Guardado|pendente/i);
    for (let i = 0; i < 8; i++) { await expect(headMood(page)).not.toHaveAttribute('data-mood', 'happy'); await page.waitForTimeout(150); }
    expect(await txCount(email)).toBe(0);
    await context.setOffline(false);
  });

  test('recusa do servidor → estado neutro; a proposta continua aberta e nada é dado como registrado', async ({ page }) => {
    const email = uniq('rej'); await signup(page, 'Eva', email);
    await page.goto('/assistente');
    await send(page, 'Gastei 8 reais com coxinha');
    await expect(page.getByTestId('draft')).toBeVisible();
    await page.route('**/rest/v1/rpc/create_transaction', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'E_VALIDATION:amount' }) }));
    await page.getByTestId('draft').getByRole('button', { name: 'Confirmar' }).click();
    await expect(headMood(page)).toHaveAttribute('data-mood', 'oops');
    await expect(page.getByTestId('draft-done')).toHaveCount(0);
    await expect(page.getByTestId('draft')).toBeVisible();
    expect(await txCount(email)).toBe(0);
  });

  test('falha do provedor de IA → neutro, mensagem clara, registro manual continua disponível', async ({ page }) => {
    await signup(page, 'Rui', uniq('prov'));
    await page.goto('/assistente');
    await page.route('**/functions/v1/interpret', (r) => r.request().method() === 'POST'
      ? r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'provider_unavailable', message: 'O assistente está indisponível. Você ainda pode registrar manualmente.' } }) })
      : r.continue());
    await send(page, 'Gastei 8 reais com coxinha');
    await expect(headMood(page)).toHaveAttribute('data-mood', 'oops');
    await expect(page.getByRole('log')).toContainText('indisponível');
    await expect(page.getByRole('button', { name: 'Registrar manualmente' }).first()).toBeVisible();
  });

  test('conta vazia: o cartão de primeiro lançamento fica totalmente visível (nada cobre o conteúdo)', async ({ page }) => {
    await signup(page, 'Bia', uniq('empty'));
    await page.waitForTimeout(2600);
    await expect(page.getByText('Comece pelo primeiro lançamento')).toBeVisible();
    await expect(page.getByTestId('mascot-hint')).toHaveCount(0);
  });

  test('manual segue funcionando e a mascote não interfere', async ({ page }) => {
    const email = uniq('manual'); await signup(page, 'Duda', email);
    await manualTx(page, { amount: '10,00', desc: 'Pao E2E' });
    await expect.poll(() => txCount(email, 'Pao E2E')).toBe(1);
    await page.goto('/');
    await expect(fab(page)).toBeVisible();
  });
});
