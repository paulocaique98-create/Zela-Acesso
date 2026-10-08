import { expect, test } from '@playwright/test';
import { goMenu, loginOk } from './helpers.js';

// Fase 2D pela UI (organizacao Alfa do seed): politica grupo -> zona. O teste apaga tudo o que criou.
const stamp = Date.now();
const ZONE = `Zona Pol E2E ${stamp}`;
const GROUP = `Grupo Pol E2E ${stamp}`;
const POLICY = `Politica E2E ${stamp}`;

/** @param {import('@playwright/test').Page} page @param {string} link @param {string} name @param {string} label */
async function createNamed(page, link, name) {
  await goMenu(page, { name: link, exact: true });
  await page.getByRole('button', { name: 'Novo' }).click();
  await page.getByLabel('Nome', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('cell', { name })).toBeVisible();
}

/** @param {import('@playwright/test').Page} page @param {string} link @param {string} name @param {string} label */
async function removeNamed(page, link, name, label) {
  await goMenu(page, { name: link, exact: true });
  await page
    .getByRole('row', { name: new RegExp(name) })
    .getByRole('button', { name: 'Excluir' })
    .click();
  await page
    .getByRole('dialog', { name: `Excluir ${label}` })
    .getByRole('button', { name: 'Excluir' })
    .click();
  await expect(page.getByRole('cell', { name })).toHaveCount(0);
}

test.describe('politicas de acesso (Fase 2D, UI)', () => {
  test('criar politica grupo->zona; negar sem desafio; isolar; grupo em uso nao apaga', async ({
    page,
    browser,
  }) => {
    test.slow();
    await loginOk(page, 'alfa.dono@example.test');
    await createNamed(page, 'Zonas', ZONE);
    await createNamed(page, 'Grupos', GROUP);

    await goMenu(page, { name: 'Políticas de acesso' });
    await page.getByRole('button', { name: 'Novo' }).click();
    const form = page.getByRole('dialog', { name: 'Nova política' });
    await form.getByLabel('Nome', { exact: true }).fill(POLICY);
    await form.getByRole('combobox', { name: 'Grupo', exact: true }).selectOption({ label: GROUP });
    await form.getByRole('combobox', { name: 'Zona', exact: true }).selectOption({ label: ZONE });
    await form.getByLabel('Exigir verificação adicional (desafio)').check();
    await form.getByRole('button', { name: 'Salvar' }).click();
    const row = page.getByRole('row', { name: new RegExp(POLICY) });
    await expect(row.getByRole('cell', { name: 'Permitir (com desafio)' })).toBeVisible();
    await expect(row.getByRole('cell', { name: `Zona: ${ZONE}` })).toBeVisible();

    // Efeito negar esconde o desafio
    await row.getByRole('button', { name: 'Editar' }).click();
    const edit = page.getByRole('dialog', { name: 'Editar política' });
    await edit.getByLabel('Efeito').selectOption('deny');
    await expect(edit.getByLabel('Exigir verificação adicional (desafio)')).toHaveCount(0);
    await edit.getByRole('button', { name: 'Salvar' }).click();
    await expect(row.getByRole('cell', { name: 'Negar', exact: true })).toBeVisible();

    // Outra organizacao nao ve; visualizador nao tem o menu; recepcao nao tem o menu
    const ctx = await browser.newContext();
    const beta = await ctx.newPage();
    await loginOk(beta, 'beta.dono@example.test');
    await goMenu(beta, { name: 'Políticas de acesso' });
    await expect(beta.getByRole('heading', { name: 'Políticas de acesso' })).toBeVisible();
    await expect(beta.getByText(POLICY)).toHaveCount(0);
    await ctx.close();

    for (const email of ['alfa.visualizador@example.test', 'alfa.recepcao@example.test']) {
      const c = await browser.newContext();
      const p = await c.newPage();
      await loginOk(p, email);
      await expect(p.getByRole('link', { name: 'Políticas de acesso' })).toHaveCount(0);
      await c.close();
    }

    // Grupo com politica nao pode ser apagado; limpeza em ordem inversa
    await goMenu(page, { name: 'Grupos', exact: true });
    await page
      .getByRole('row', { name: new RegExp(GROUP) })
      .getByRole('button', { name: 'Excluir' })
      .click();
    await page
      .getByRole('dialog', { name: 'Excluir grupo' })
      .getByRole('button', { name: 'Excluir' })
      .click();
    await expect(
      page.getByText('Este registro está em uso e não pode ser excluído.'),
    ).toBeVisible();
    await page
      .getByRole('dialog', { name: 'Excluir grupo' })
      .getByRole('button', { name: 'Cancelar' })
      .click();

    await removeNamed(page, 'Políticas de acesso', POLICY, 'política');
    await removeNamed(page, 'Grupos', GROUP, 'grupo');
    await removeNamed(page, 'Zonas', ZONE, 'zona');
  });
});
