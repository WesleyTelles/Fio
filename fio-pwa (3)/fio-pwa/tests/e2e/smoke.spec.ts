import { test, expect } from '@playwright/test';
import { signup, uniq, manualTx, txCount } from './helpers';

test('cadastro, lançamento manual e persistência após recarregar', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const email = uniq('a');
  await signup(page, 'Ana', email);
  await manualTx(page, { amount: '42,50', desc: 'Almoço E2E' });
  await expect(page.getByText('Lançamento registrado.')).toBeVisible();
  expect(await txCount(email, 'Almoço E2E')).toBe(1);
  await page.goto('/movimentacoes');
  await expect(page.getByRole('button', { name: /Almoço E2E/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Almoço E2E/ })).toBeVisible();
  expect(errors).toEqual([]);
});
