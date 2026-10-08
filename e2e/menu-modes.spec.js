import { expect, test } from '@playwright/test';
import { loginOk } from './helpers.js';

// Menu Cadastro (criar) e Gerenciar (editar): mesmas telas, modos diferentes. Dados sinteticos do seed local.
async function openMenu(page, group, link) {
  const nav = page.getByRole('navigation', { name: 'Principal' });
  await nav.waitFor();
  const target = nav.getByRole('link', { name: link, exact: true, includeHidden: true }).first();
  await target.waitFor({ state: 'attached' });
  if (!(await target.isVisible())) {
    await nav.getByRole('button', { name: group }).first().click();
  }
  await target.click();
}

test.describe('menu Cadastro e Gerenciar (UI)', () => {
  test('Cadastro abre o formulario e nao edita; Gerenciar edita e nao cria', async ({ page }) => {
    await loginOk(page, 'alfa.dono@example.test');

    await openMenu(page, 'Cadastro', 'Cadastrar pessoa');
    await expect(page.getByRole('heading', { name: 'Cadastro · Pessoas' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Nova pessoa' })).toBeVisible();
    await page.getByRole('button', { name: 'Fechar' }).click();
    await expect(page.getByRole('button', { name: 'Novo', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Excluir' })).toHaveCount(0);

    await openMenu(page, 'Gerenciar', 'Pessoas');
    await expect(page.getByRole('heading', { name: 'Gerenciar · Pessoas' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Novo', exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Editar' }).first()).toBeVisible();
  });

  test('Cadastro de local abre o formulario com o campo do Zela Pass', async ({ page }) => {
    await loginOk(page, 'alfa.dono@example.test');
    await openMenu(page, 'Cadastro', 'Cadastrar local');
    await expect(page.getByRole('dialog', { name: 'Novo local' })).toBeVisible();
    await expect(page.getByLabel('Endereço do Zela Pass (opcional)')).toBeVisible();
  });
});
