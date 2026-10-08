import { expect, test } from '@playwright/test';
import { loginOk, localAdmin, goMenu } from './helpers.js';

// Fase 5B pela UI (organizacao Alfa do seed): convite -> QR/token -> check-in por token -> check-out.
// Visitas nao tem exclusao pela UI; a limpeza usa o admin do Supabase local descartavel.
const stamp = Date.now();
const HOST = `Anfitriao Vis E2E ${stamp}`;
const ZONE = `Zona Vis E2E ${stamp}`;
const VISITOR = `Visitante E2E ${stamp}`;
const VISITOR2 = `Visitante Cancel E2E ${stamp}`;

async function cleanup() {
  const admin = localAdmin();
  const { data: visits } = await admin
    .from('visits')
    .select('id, person_id, credential_id')
    .like('visitor_name', `%E2E ${stamp}`);
  const ids = (visits ?? []).map((v) => v.id);
  if (ids.length) await admin.from('visits').delete().in('id', ids);
  const creds = (visits ?? []).map((v) => v.credential_id).filter(Boolean);
  if (creds.length) await admin.from('credentials').delete().in('id', creds);
  const persons = (visits ?? []).map((v) => v.person_id).filter(Boolean);
  if (persons.length) await admin.from('people').delete().in('id', persons);
  await admin.from('people').delete().eq('full_name', HOST);
  await admin.from('zones').delete().eq('name', ZONE);
}

test.describe('visitantes (Fase 5B, UI)', () => {
  test.afterAll(cleanup);

  test('convite com QR, check-in por token, check-out, cancelamento e isolamento', async ({
    page,
    browser,
  }) => {
    test.slow();
    await loginOk(page, 'alfa.dono@example.test');

    await goMenu(page, { name: 'Pessoas' });
    await page.getByRole('button', { name: 'Novo' }).click();
    await page.getByLabel('Nome completo').fill(HOST);
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('cell', { name: HOST })).toBeVisible();
    await goMenu(page, { name: 'Zonas', exact: true });
    await page.getByRole('button', { name: 'Novo' }).click();
    await page.getByLabel('Nome', { exact: true }).fill(ZONE);
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('cell', { name: ZONE })).toBeVisible();

    // Convite
    await goMenu(page, { name: 'Visitantes' });
    await page.getByRole('button', { name: 'Novo' }).click();
    const form = page.getByRole('dialog', { name: 'Novo convite' });
    await form.getByLabel('Anfitrião').selectOption({ label: HOST });
    await form.getByLabel('Nome do visitante').fill(VISITOR);
    await form.getByLabel('Placa do veículo (opcional)').fill('abc-1d23');
    await form.getByLabel(ZONE).check();
    await form.getByRole('button', { name: 'Criar convite' }).click();
    const invite = page.getByRole('dialog', { name: 'Convite criado' });
    await expect(invite.getByRole('img', { name: 'QR code' })).toBeVisible();
    const token = (await invite.locator('code').innerText()).trim();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    await invite.getByRole('button', { name: 'Fechar' }).click();
    const row = page.getByRole('row', { name: new RegExp(VISITOR) });
    await expect(row.getByRole('cell', { name: 'Convidado' })).toBeVisible();
    await expect(row.getByRole('cell', { name: ZONE })).toBeVisible();

    // Token invalido: falha generica
    await page.getByRole('button', { name: 'Check-in por token' }).click();
    const ci = page.getByRole('dialog', { name: 'Check-in de visitante' });
    await ci.getByLabel('Token do convite (QR)').fill('0'.repeat(64));
    await ci.getByLabel('Visitante ciente do aviso de privacidade').check();
    await ci.getByRole('button', { name: 'Registrar entrada' }).click();
    await expect(page.getByText('Convite inválido, expirado ou fora do horário.')).toBeVisible();

    // Token correto: entrega a credencial (diferente do convite)
    await ci.getByLabel('Token do convite (QR)').fill(token);
    await ci.getByRole('button', { name: 'Registrar entrada' }).click();
    const badge = page.getByRole('dialog', { name: 'Credencial do visitante' });
    const cred = (await badge.locator('code').innerText()).trim();
    expect(cred).toMatch(/^[0-9a-f]{64}$/);
    expect(cred).not.toBe(token);
    await badge.getByRole('button', { name: 'Fechar' }).click();
    await expect(row.getByRole('cell', { name: 'Presente' })).toBeVisible();

    // Check-out
    await row.getByRole('button', { name: 'Check-out' }).click();
    await page
      .getByRole('dialog', { name: 'Registrar saída' })
      .getByRole('button', { name: 'Registrar saída' })
      .click();
    await expect(row.getByRole('cell', { name: 'Saiu' })).toBeVisible();

    // Cancelamento de outro convite
    await page.getByRole('button', { name: 'Novo' }).click();
    const form2 = page.getByRole('dialog', { name: 'Novo convite' });
    await form2.getByLabel('Anfitrião').selectOption({ label: HOST });
    await form2.getByLabel('Nome do visitante').fill(VISITOR2);
    await form2.getByLabel(ZONE).check();
    await form2.getByRole('button', { name: 'Criar convite' }).click();
    await page
      .getByRole('dialog', { name: 'Convite criado' })
      .getByRole('button', { name: 'Fechar' })
      .click();
    const row2 = page.getByRole('row', { name: new RegExp(VISITOR2) });
    await row2.getByRole('button', { name: 'Cancelar' }).click();
    await page
      .getByRole('dialog', { name: 'Cancelar convite' })
      .getByRole('button', { name: 'Cancelar convite' })
      .click();
    await expect(row2.getByRole('cell', { name: 'Cancelado' })).toBeVisible();

    // Outra organizacao nao ve; visualizador nao tem o menu; recepcao opera
    const ctx = await browser.newContext();
    const beta = await ctx.newPage();
    await loginOk(beta, 'beta.dono@example.test');
    await goMenu(beta, { name: 'Visitantes' });
    await expect(beta.getByRole('heading', { name: 'Visitantes' })).toBeVisible();
    await expect(beta.getByText(VISITOR)).toHaveCount(0);
    await ctx.close();

    const ctxV = await browser.newContext();
    const viewer = await ctxV.newPage();
    await loginOk(viewer, 'alfa.visualizador@example.test');
    await expect(viewer.getByRole('link', { name: 'Visitantes' })).toHaveCount(0);
    await ctxV.close();

    const ctxR = await browser.newContext();
    const recep = await ctxR.newPage();
    await loginOk(recep, 'alfa.recepcao@example.test');
    await goMenu(recep, { name: 'Visitantes' });
    await expect(recep.getByRole('cell', { name: VISITOR }).first()).toBeVisible();
    await expect(recep.getByRole('button', { name: 'Check-in por token' })).toBeVisible();
    await ctxR.close();
  });
});
