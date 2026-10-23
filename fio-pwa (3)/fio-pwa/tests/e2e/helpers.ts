import { expect, type Page } from '@playwright/test';
import pg from 'pg';

export const GW = 'http://localhost:54321';
export const PASS = 'senha-forte-123';
export const uniq = (p: string) => `${p}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@teste.local`;

export async function db<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const c = new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', database: 'fio_test' });
  await c.connect(); try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
}
export const txCount = async (email: string, desc?: string) =>
  Number((await db(`select count(*)::int n from public.transactions t join auth.users u on u.id=t.user_id where u.email=$1 and t.deleted_at is null ${desc ? 'and t.description=$2' : ''}`, desc ? [email, desc] : [email]))[0].n);

export async function signup(page: Page, name: string, email: string, pass = PASS) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Não tenho conta — criar' }).click();
  await page.getByLabel('Nome').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(pass);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
}
export async function login(page: Page, email: string, pass = PASS) {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(pass);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
}
export async function manualTx(page: Page, { amount, desc, cat = 'Alimentação', type = 'Despesa' }: { amount: string; desc: string; cat?: string; type?: string }) {
  await page.goto('/assistente');
  await page.getByRole('button', { name: 'Registrar manualmente' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: type }).click();
  await dlg.getByLabel('Valor (R$)').fill(amount);
  await dlg.getByLabel('Descrição').fill(desc);
  await dlg.getByLabel('Categoria').selectOption({ label: cat });
  await dlg.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(dlg).toBeHidden();
}
