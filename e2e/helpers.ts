import { expect, type Page } from '@playwright/test';

// Usuarios sinteticos criados por scripts/seed-dev.mjs (somente banco local descartavel).
export const DEV_PASSWORD = 'Zela-Dev-Local-1234';
export const API = 'http://127.0.0.1:55321';

export async function login(page: Page, email: string, password = DEV_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

export async function loginOk(page: Page, email: string) {
  await login(page, email);
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
}
