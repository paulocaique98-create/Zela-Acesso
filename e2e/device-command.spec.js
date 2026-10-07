import { expect, test } from '@playwright/test';
import { loginOk } from './helpers.js';

// Fase 4E, UI do operador: abertura remota. O seed nao tem agente Edge, entao o pedido do dono recebe a
// mensagem "sem agente" (o fluxo completo com agente real esta em apps/edge-agent/e2e/device-command.e2e.mjs).
// O teste apaga tudo o que criou.
const stamp = Date.now();
const ZONE = `Zona Cmd E2E ${stamp}`;
const POINT = `Ponto Cmd E2E ${stamp}`;

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

test.describe('abertura remota de ponto (Fase 4E, UI)', () => {
  test('dono pede abertura (sem agente => aviso); recepcao nao ve o botao', async ({
    page,
    browser,
  }) => {
    test.slow();
    await loginOk(page, 'alfa.dono@example.test');

    await page.getByRole('link', { name: 'Zonas', exact: true }).click();
    await page.getByRole('button', { name: 'Novo' }).click();
    await page.getByLabel('Nome', { exact: true }).fill(ZONE);
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('cell', { name: ZONE })).toBeVisible();

    await page.getByRole('link', { name: 'Pontos de acesso' }).click();
    await page.getByRole('button', { name: 'Novo' }).click();
    const form = page.getByRole('dialog', { name: 'Novo ponto de acesso' });
    await form.getByLabel('Zona').selectOption({ label: ZONE });
    await form.getByLabel('Nome', { exact: true }).fill(POINT);
    await form.getByRole('button', { name: 'Salvar' }).click();
    const row = page.getByRole('row', { name: new RegExp(POINT) });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Abrir remotamente' }).click();
    const dlg = page.getByRole('dialog', { name: 'Abrir ponto remotamente' });
    await expect(dlg.getByRole('button', { name: 'Abrir ponto' })).toBeDisabled();
    await dlg.getByLabel(/Motivo/).fill('Teste E2E sem agente');
    await dlg.getByRole('button', { name: 'Abrir ponto' }).click();
    await expect(page.getByText('Não há agente Edge ativo neste local')).toBeVisible();
    await dlg.getByRole('button', { name: 'Cancelar' }).click();

    // Recepcao le pontos mas nao tem device:command
    const ctxR = await browser.newContext();
    const recep = await ctxR.newPage();
    await loginOk(recep, 'alfa.recepcao@example.test');
    await recep.getByRole('link', { name: 'Pontos de acesso' }).click();
    await expect(recep.getByRole('cell', { name: POINT })).toBeVisible();
    await expect(recep.getByRole('button', { name: 'Abrir remotamente' })).toHaveCount(0);
    await ctxR.close();

    await removeRow(page, POINT, 'ponto de acesso');
    await page.getByRole('link', { name: 'Zonas', exact: true }).click();
    await removeRow(page, ZONE, 'zona');
  });
});
