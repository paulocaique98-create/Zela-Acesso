import { expect, test } from '@playwright/test';
import { loginOk } from './helpers.js';

// Fase 2C pela UI (organizacao Alfa do seed): predio, andar, zona com predio/andar e ponto de acesso.
// O teste apaga tudo o que criou.
const stamp = Date.now();
const BUILDING = `Predio E2E ${stamp}`;
const FLOOR = `Andar E2E ${stamp}`;
const ZONE = `Zona Fisica E2E ${stamp}`;
const POINT = `Ponto E2E ${stamp}`;

/** @param {import('@playwright/test').Page} page @param {string} name @param {string} label */
async function removeRow(page, name, label) {
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

test.describe('hierarquia fisica e pontos de acesso (Fase 2C, UI)', () => {
  test('criar predio, andar, zona e ponto; emergencia avisa; isolar; apagar na ordem inversa', async ({
    page,
    browser,
  }) => {
    test.slow();
    await loginOk(page, 'alfa.dono@example.test');

    // Predio + andar
    await page.getByRole('link', { name: 'Prédios e andares' }).click();
    await page.getByRole('button', { name: 'Novo' }).click();
    await page.getByLabel('Nome', { exact: true }).fill(BUILDING);
    await page.getByRole('button', { name: 'Salvar' }).click();
    const buildingRow = page.getByRole('row', { name: new RegExp(BUILDING) });
    await expect(buildingRow).toBeVisible();
    await buildingRow.getByRole('button', { name: 'Andares' }).click();
    const floors = page.getByRole('dialog', { name: /Andares/ });
    await floors.getByLabel('Nome do andar').fill(FLOOR);
    await floors.getByRole('button', { name: 'Adicionar andar' }).click();
    await expect(floors.getByRole('cell', { name: FLOOR })).toBeVisible();
    await floors.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(buildingRow.getByRole('cell', { name: '1', exact: true })).toBeVisible();

    // Zona com predio e andar
    await page.getByRole('link', { name: 'Zonas', exact: true }).click();
    await page.getByRole('button', { name: 'Novo' }).click();
    await page.getByLabel('Nome', { exact: true }).fill(ZONE);
    await page.getByLabel('Prédio (opcional)').selectOption({ label: BUILDING });
    await page.getByLabel('Andar (opcional)').selectOption({ label: FLOOR });
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(
      page.getByRole('row', { name: new RegExp(ZONE) }).getByRole('cell', {
        name: `${BUILDING} / ${FLOOR}`,
      }),
    ).toBeVisible();

    // Ponto de acesso: padrao seguro e aviso ao escolher fail-secure
    await page.getByRole('link', { name: 'Pontos de acesso' }).click();
    await page.getByRole('button', { name: 'Novo' }).click();
    const form = page.getByRole('dialog', { name: 'Novo ponto de acesso' });
    await expect(form.getByLabel('Comportamento em emergência')).toHaveValue('fail_safe');
    await expect(form.getByLabel('Comportamento sem conexão')).toHaveValue('degraded_deny');
    await form.getByLabel('Zona').selectOption({ label: ZONE });
    await form.getByLabel('Nome', { exact: true }).fill(POINT);
    await form.getByLabel('Tipo').selectOption('turnstile');
    await form.getByLabel('Comportamento em emergência').selectOption('fail_secure');
    await expect(form.getByRole('note').filter({ hasText: 'saída segura' })).toBeVisible();
    await form.getByLabel('Tempo de porta aberta (segundos)').fill('15');
    await form.getByRole('button', { name: 'Salvar' }).click();
    const pointRow = page.getByRole('row', { name: new RegExp(POINT) });
    await expect(pointRow.getByRole('cell', { name: 'Catraca' })).toBeVisible();

    // Outra organizacao nao ve nada disso; visualizador nao ve pontos; recepcao so le
    const ctx = await browser.newContext();
    const beta = await ctx.newPage();
    await loginOk(beta, 'beta.dono@example.test');
    await beta.getByRole('link', { name: 'Pontos de acesso' }).click();
    await expect(beta.getByRole('heading', { name: 'Pontos de acesso' })).toBeVisible();
    await expect(beta.getByText(POINT)).toHaveCount(0);
    await beta.getByRole('link', { name: 'Prédios e andares' }).click();
    await expect(beta.getByText(BUILDING)).toHaveCount(0);
    await ctx.close();

    const ctxV = await browser.newContext();
    const viewer = await ctxV.newPage();
    await loginOk(viewer, 'alfa.visualizador@example.test');
    await expect(viewer.getByRole('link', { name: 'Pontos de acesso' })).toHaveCount(0);
    await ctxV.close();

    const ctxR = await browser.newContext();
    const recep = await ctxR.newPage();
    await loginOk(recep, 'alfa.recepcao@example.test');
    await recep.getByRole('link', { name: 'Pontos de acesso' }).click();
    await expect(recep.getByRole('cell', { name: POINT })).toBeVisible();
    await expect(recep.getByRole('button', { name: 'Novo' })).toHaveCount(0);
    await expect(
      recep.getByRole('row', { name: new RegExp(POINT) }).getByRole('button', { name: 'Editar' }),
    ).toHaveCount(0);
    await ctxR.close();

    // Zona com ponto nao pode ser apagada; limpeza em ordem inversa
    await page.getByRole('link', { name: 'Zonas', exact: true }).click();
    await page
      .getByRole('row', { name: new RegExp(ZONE) })
      .getByRole('button', { name: 'Excluir' })
      .click();
    await page
      .getByRole('dialog', { name: 'Excluir zona' })
      .getByRole('button', { name: 'Excluir' })
      .click();
    await expect(
      page.getByText('Este registro está em uso e não pode ser excluído.'),
    ).toBeVisible();
    await page
      .getByRole('dialog', { name: 'Excluir zona' })
      .getByRole('button', { name: 'Cancelar' })
      .click();

    await page.getByRole('link', { name: 'Pontos de acesso' }).click();
    await removeRow(page, POINT, 'ponto de acesso');
    await page.getByRole('link', { name: 'Zonas', exact: true }).click();
    await removeRow(page, ZONE, 'zona');
    await page.getByRole('link', { name: 'Prédios e andares' }).click();
    await page
      .getByRole('row', { name: new RegExp(BUILDING) })
      .getByRole('button', { name: 'Andares' })
      .click();
    const cleanup = page.getByRole('dialog', { name: /Andares/ });
    await cleanup
      .getByRole('row', { name: new RegExp(FLOOR) })
      .getByRole('button', { name: 'Excluir' })
      .click();
    await expect(cleanup.getByRole('cell', { name: FLOOR })).toHaveCount(0);
    await cleanup.getByRole('button', { name: 'Fechar', exact: true }).click();
    await removeRow(page, BUILDING, 'prédio');
  });
});
