import { expect, test } from '@playwright/test';
import { loginOk } from './helpers.js';

test.describe('Painel do Desenvolvedor', () => {
  test('platform_owner cai no painel, lista organizacoes e cria uma nova', async ({ page }) => {
    await loginOk(page, 'plataforma.dono@example.test');
    await expect(page).toHaveURL(/\/plataforma$/);
    await expect(page.getByText('Painel do Desenvolvedor').first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Condomínio Alfa (exemplo)' })).toBeVisible();

    const slug = `e2e-${Date.now()}`;
    await page.getByRole('button', { name: 'Nova organização' }).click();
    await page.getByLabel('Nome').fill(`Org ${slug}`);
    await page.getByLabel(/Identificador/).fill(slug);
    await page.getByLabel('E-mail do proprietário').fill('alfa.dono@example.test');
    await page.getByRole('button', { name: 'Criar organização' }).click();
    await expect(page.getByRole('cell', { name: slug, exact: true })).toBeVisible();
  });

  test('e-mail de dono inexistente mostra erro generico e nao cria', async ({ page }) => {
    await loginOk(page, 'plataforma.dono@example.test');
    await page.getByRole('button', { name: 'Nova organização' }).click();
    await page.getByLabel('Nome').fill('Org Fantasma');
    await page.getByLabel('E-mail do proprietário').fill('ninguem@example.test');
    await page.getByRole('button', { name: 'Criar organização' }).click();
    await expect(page.getByRole('alert')).toContainText('Não existe usuário com esse e-mail');
  });

  test('platform_support ve a lista, sem criar nem suspender', async ({ page }) => {
    await loginOk(page, 'plataforma.suporte@example.test');
    await expect(page).toHaveURL(/\/plataforma$/);
    await expect(page.getByRole('cell', { name: 'Condomínio Alfa (exemplo)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova organização' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Suspender' })).toHaveCount(0);
  });

  test('proprietario de organizacao nao acessa /plataforma', async ({ page }) => {
    await loginOk(page, 'alfa.dono@example.test');
    await page.goto('/plataforma');
    await expect(page).not.toHaveURL(/plataforma/);
    await expect(page.getByRole('link', { name: 'Painel do Desenvolvedor' })).toHaveCount(0);
  });

  test('rota /plataforma sem login vai para /login', async ({ page }) => {
    await page.goto('/plataforma');
    await expect(page).toHaveURL(/\/login$/);
  });
});
