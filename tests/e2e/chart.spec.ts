import { test, expect } from '@playwright/test';
import { signup, uniq, manualTx } from './helpers';

test('gráfico de evolução do saldo: vazio, receita/despesa, períodos, teclado e ocultar saldo', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await signup(page, 'Bia', uniq('chart'));
  const chart = page.getByRole('region', { name: 'Evolução do saldo' });
  await expect(chart).toBeVisible();
  await expect(chart.getByTestId('chart-delta')).toContainText('Sem variação nos últimos 30 dias');

  await manualTx(page, { amount: '1000', desc: 'Salário E2E', cat: 'Salário', type: 'Receita' });
  await manualTx(page, { amount: '250,50', desc: 'Mercado E2E' });
  await page.goto('/');
  await expect(chart.getByTestId('chart-delta')).toContainText('+R$ 749,50');
  await expect(chart.getByTestId('chart-delta')).toContainText('últimos 30 dias');

  await chart.getByRole('button', { name: '7D' }).click();
  await expect(chart.getByRole('button', { name: '7D' })).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.getByTestId('chart-delta')).toContainText('últimos 7 dias');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Evolução do saldo' }).getByRole('button', { name: '7D' })).toHaveAttribute('aria-pressed', 'true'); // período lembrado

  const slider = page.getByRole('slider', { name: /Evolução do saldo/ });
  await slider.focus();
  await slider.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', /Hoje: R\$ 749,50/);
  await slider.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', /R\$ 0,00/);
  await expect(page.getByTestId('chart-readout')).toContainText('R$ 0,00');

  await page.getByRole('button', { name: 'Ocultar saldo' }).click();
  await expect(page.getByRole('region', { name: 'Evolução do saldo' }).getByTestId('chart-delta')).toContainText('••••');
  await expect(page.getByRole('region', { name: 'Evolução do saldo' }).getByTestId('chart-delta')).not.toContainText('749');
  await page.screenshot({ path: '/tmp/claude-0/-home-claude/559195d0-7eb8-5848-b1a0-f5a56ce220f6/scratchpad/chart-hidden.png' });
  expect(errors).toEqual([]);
});
