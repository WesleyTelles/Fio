import { test, expect } from '@playwright/test';
import { signup, login, uniq, manualTx, txCount, db, GW, PASS } from './helpers';

const nav = (p: import('@playwright/test').Page) => p.getByRole('navigation', { name: 'Navegação principal' });

test.describe('assistente de IA (modo demonstração)', () => {
  test('confirmar, editar e cancelar; ambiguidade pergunta; pergunta não registra', async ({ page }) => {
    const email = uniq('ai'); await signup(page, 'Bia', email);
    await page.goto('/assistente');
    await expect(page.getByTestId('ai-mode')).toHaveText('Modo demonstração');

    // 1) Confirmar: nada é salvo antes
    await page.getByLabel('Mensagem para o assistente').fill('Gastei 8 reais com coxinha');
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    const draft = page.getByTestId('draft'); await expect(draft).toBeVisible();
    await expect(draft).toContainText('R$'); await expect(draft).toContainText('nada foi salvo ainda');
    expect(await txCount(email)).toBe(0);
    await draft.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('draft-done')).toBeVisible();
    expect(await txCount(email, 'Coxinha')).toBe(1);

    // 2) Ambiguidade: "Gastei 20 reais" precisa pedir esclarecimento, sem registrar
    await page.getByLabel('Mensagem para o assistente').fill('Gastei 20 reais');
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(page.getByRole('log').getByText(/o que|com o quê|qual/i).last()).toBeVisible();
    expect(await txCount(email)).toBe(1);

    // 3) Pergunta não vira lançamento
    await page.getByLabel('Mensagem para o assistente').fill('Quanto gastei esta semana?');
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(page.getByRole('log')).toContainText(/R\$/);
    expect(await txCount(email)).toBe(1);

    // 4) Cancelar não registra
    await page.getByLabel('Mensagem para o assistente').fill('Recebi 250 reais de um freela');
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await page.getByTestId('draft').last().getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByText('Cancelado. Nada foi registrado.')).toBeVisible();
    expect(await txCount(email)).toBe(1);

    // 5) Editar abre o formulário com os dados e só registra ao confirmar lá
    await page.getByLabel('Mensagem para o assistente').fill('Gastei 35 no mercado');
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await page.getByTestId('draft').last().getByRole('button', { name: 'Editar' }).click();
    const dlg = page.getByRole('dialog'); await expect(dlg.getByLabel('Valor (R$)')).toHaveValue(/35/);
    await dlg.getByLabel('Valor (R$)').fill('36,00');
    await dlg.getByRole('button', { name: /Confirmar e registrar/ }).click();
    await expect.poll(() => txCount(email)).toBe(2);
    const row = (await db(`select amount::text a from public.transactions t join auth.users u on u.id=t.user_id where u.email=$1 order by t.created_at desc limit 1`, [email]))[0];
    expect(row.a).toBe('36.00');
  });
});

test('editar, excluir e desfazer', async ({ page }) => {
  const email = uniq('ed'); await signup(page, 'Caio', email);
  await manualTx(page, { amount: '10,00', desc: 'Cafe E2E' });
  await page.goto('/movimentacoes');
  await page.getByRole('button', { name: /Cafe E2E/ }).click();
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByRole('dialog').getByLabel('Valor (R$)').fill('12,00');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByRole('button', { name: /Cafe E2E.*12,00/ })).toBeVisible();
  await page.getByRole('button', { name: /Cafe E2E/ }).click();
  await page.getByRole('button', { name: 'Excluir' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Excluir', exact: true }).click();
  await expect(page.getByText('Lançamento excluído.')).toBeVisible();
  expect(await txCount(email, 'Cafe E2E')).toBe(0);
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await expect.poll(() => txCount(email, 'Cafe E2E')).toBe(1);
});

test('logout e login de novo preservam os dados (vêm do servidor)', async ({ page }) => {
  const email = uniq('lo'); await signup(page, 'Duda', email);
  await manualTx(page, { amount: '5,00', desc: 'Pao E2E' });
  await page.goto('/perfil');
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.goto('/movimentacoes');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible(); // rota protegida
  await login(page, email);
  await page.goto('/movimentacoes');
  await expect(page.getByRole('button', { name: /Pao E2E/ })).toBeVisible();
});

test.describe('offline e sincronização', () => {
  test('lança offline → pendente → volta a conexão → sincroniza sem duplicar', async ({ page, context }) => {
    const email = uniq('of'); await signup(page, 'Eva', email);
    await page.goto('/assistente'); await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    await expect(page.getByLabel(/Estado de sincronização: Offline/)).toBeVisible().catch(() => {});
    await page.getByRole('button', { name: 'Registrar manualmente' }).first().click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Valor (R$)').fill('19,90'); await dlg.getByLabel('Descrição').fill('Offline E2E');
    await dlg.getByLabel('Categoria').selectOption({ label: 'Lazer' });
    await dlg.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByText(/pendente de sincronização/i).first()).toBeVisible();
    expect(await txCount(email, 'Offline E2E')).toBe(0);
    await context.setOffline(false);
    await expect.poll(() => txCount(email, 'Offline E2E'), { timeout: 20000 }).toBe(1);
    await page.waitForTimeout(1500);
    expect(await txCount(email, 'Offline E2E')).toBe(1);
    await page.goto('/');
    await expect(page.getByLabel(/Estado de sincronização: Sincronizado/)).toBeVisible({ timeout: 15000 });
  });

  test('resposta perdida: servidor grava, cliente não vê → reenvio não duplica', async ({ page }) => {
    const email = uniq('dp'); await signup(page, 'Fábio', email);
    await page.goto('/assistente'); await page.waitForLoadState('networkidle');
    let hits = 0;
    await page.route('**/rest/v1/rpc/create_transaction', async (route) => {
      hits++;
      if (hits === 1) { await route.fetch(); await route.abort('connectionreset'); } else await route.continue();
    });
    await page.getByRole('button', { name: 'Registrar manualmente' }).first().click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Valor (R$)').fill('77,00'); await dlg.getByLabel('Descrição').fill('Dup E2E');
    await dlg.getByLabel('Categoria').selectOption({ label: 'Compras' });
    await dlg.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect.poll(() => txCount(email, 'Dup E2E')).toBe(1); // gravou no servidor
    // força reenvio da mesma operação
    await page.goto('/');
    await page.getByLabel(/Estado de sincronização/).click();
    const send = page.getByRole('button', { name: 'Tentar sincronizar agora' });
    if (await send.isVisible().catch(() => false)) await send.click();
    await expect(page.getByLabel(/Estado de sincronização: Sincronizado/)).toBeVisible({ timeout: 20000 });
    expect(hits).toBeGreaterThanOrEqual(2);
    expect(await txCount(email, 'Dup E2E')).toBe(1);
  });

  test('pendência de outra conta nunca sincroniza na conta nova (e continua guardada para a dona)', async ({ page, context }) => {
    const a = uniq('pa'), b = uniq('pb'); await signup(page, 'Gi', a);
    await page.goto('/assistente'); await page.waitForLoadState('networkidle');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Registrar manualmente' }).first().click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Valor (R$)').fill('3,00'); await dlg.getByLabel('Descrição').fill('Da conta A');
    await dlg.getByLabel('Categoria').selectOption({ label: 'Lazer' });
    await dlg.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByText(/pendente de sincronização/i).first()).toBeVisible();
    // outra pessoa usa o aparelho: sessão some (storage limpo) e a página recarrega ainda offline
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k)));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Não tenho conta — criar' }).click();
    await page.getByLabel('Nome').fill('Hugo'); await page.getByLabel('E-mail').fill(b); await page.getByLabel('Senha', { exact: true }).fill(PASS);
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByRole('heading', { name: 'Assistente' })).toBeVisible(); // volta à rota anterior (/assistente, sem nav)
    await page.waitForTimeout(3000);
    expect(await txCount(b)).toBe(0);
    expect(await txCount(a, 'Da conta A')).toBe(0);   // não foi enviada por B, nem como B
    await page.goto('/perfil'); await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await login(page, a);                              // a dona volta: a pendência dela sincroniza
    await expect.poll(() => txCount(a, 'Da conta A'), { timeout: 20000 }).toBe(1);
    expect(await txCount(b)).toBe(0);
  });
});

test('isolamento entre usuários (API direta com o token do usuário B)', async ({ page, browser, request }) => {
  const a = uniq('ia'), b = uniq('ib'); await signup(page, 'Iara', a);
  await manualTx(page, { amount: '99,00', desc: 'Segredo da A' });
  const idA = (await db(`select t.id from public.transactions t join auth.users u on u.id=t.user_id where u.email=$1`, [a]))[0].id;

  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage(); await signup(p2, 'Joel', b);
  const anon = (await (await request.get(`${GW}/__test/anon-key`)).json()).anonKey;
  const tok = await (await request.post(`${GW}/auth/v1/token?grant_type=password`, { headers: { apikey: anon }, data: { email: b, password: PASS } })).json();
  const H = { apikey: anon, authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' };
  const list = await (await request.get(`${GW}/rest/v1/transactions?select=id`, { headers: H })).json();
  expect(list).toEqual([]);
  const direct = await (await request.get(`${GW}/rest/v1/transactions?select=id&id=eq.${idA}`, { headers: H })).json();
  expect(direct).toEqual([]);
  const upd = await request.post(`${GW}/rest/v1/rpc/update_transaction`, { headers: H, data: { p_id: idA, p_patch: { amount: 1 }, p_expected_updated_at: null } });
  expect(upd.ok()).toBeFalsy();
  const del = await request.post(`${GW}/rest/v1/rpc/delete_transaction`, { headers: H, data: { p_id: idA } });
  expect(del.ok()).toBeFalsy();
  const anonRead = await request.get(`${GW}/rest/v1/transactions?select=id`, { headers: { apikey: anon } });
  expect(anonRead.ok() ? await anonRead.json() : []).toEqual([]);
  expect(await txCount(a, 'Segredo da A')).toBe(1); // intacto
  await p2.goto('/movimentacoes'); await expect(p2.getByText('Segredo da A')).toHaveCount(0);
  await ctx2.close();
});

test('sessão expirada de verdade (access token vencido + refresh revogado): volta ao login com aviso', async ({ page, request }) => {
  const email = uniq('ex'); await signup(page, 'Kai', email);
  await request.get(`${GW}/__test/revoke`);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sb-') && k.endsWith('-auth-token')) { const j = JSON.parse(localStorage.getItem(k)!); j.expires_at = 1; localStorage.setItem(k, JSON.stringify(j)); } });
  await page.goto('/movimentacoes');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/sessão expirou/i)).toBeVisible();
  await login(page, email); // reentrar funciona
});

test('401 do servidor com sessão ainda válida no cliente: app sinaliza "Sessão expirada" sem perder dados', async ({ page }) => {
  const email = uniq('ex2'); await signup(page, 'Kai2', email);
  await manualTx(page, { amount: '2,00', desc: 'Antes do 401' });
  await page.route('**/rest/v1/**', (r) => r.request().method() === 'OPTIONS' ? r.fallback() : r.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }) }));
  await page.goto('/');
  await expect(page.getByText(/sessão expirou/i).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible(); // continua dentro do app, sem perder o que já estava na tela
});

test('recuperação de senha de ponta a ponta', async ({ page, request }) => {
  const email = uniq('rc'); await signup(page, 'Lia', email);
  await page.goto('/perfil'); await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await page.getByLabel('E-mail').fill(email); await page.getByRole('button', { name: 'Enviar link' }).click();
  await expect(page.getByText(/enviamos um link/i)).toBeVisible();
  const mails = await (await request.get(`${GW}/__test/outbox`)).json();
  const link = mails.filter((m: any) => m.to === email).pop().link;
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Nova senha' })).toBeVisible();
  await page.getByLabel('Nova senha').fill('outra-senha-456'); await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(nav(page)).toBeVisible();
  await page.goto('/perfil'); await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await login(page, email, 'outra-senha-456');
});

test('validação: senha curta e login errado mostram erro', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('E-mail').fill('x@teste.local'); await page.getByLabel('Senha', { exact: true }).fill('errada');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Não tenho conta — criar' }).click();
  await page.getByLabel('Nome').fill('Z'); await page.getByLabel('E-mail').fill('z@teste.local'); await page.getByLabel('Senha', { exact: true }).fill('123');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByText('Use pelo menos 8 caracteres.')).toBeVisible();
});
