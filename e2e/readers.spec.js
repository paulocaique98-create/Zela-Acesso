import { expect, test } from '@playwright/test';
import { goMenu, localAdmin, loginOk } from './helpers.js';

// Zela Pass (D-027) pela UI do painel (organizacao Alfa do seed): ponto "Somente registro", leitor criado com codigo de
// ativacao mostrado UMA vez, revogacao com motivo e isolamento por papel. O teste apaga/revoga o que criou.
const stamp = Date.now();
const ZONE = `Zona Registro E2E ${stamp}`;
const POINT = `Ponto Registro E2E ${stamp}`;
const READER = `Tablet E2E ${stamp}`;

test.afterAll(async () => {
  // Leitor nao tem DELETE pela API (so revogar); a limpeza do dado de teste e feita pelo admin do banco LOCAL.
  const admin = localAdmin();
  await admin.from('access_readers').delete().like('name', 'Tablet E2E %');
  await admin.from('access_points').delete().like('name', 'Ponto Registro E2E %');
  await admin.from('zones').delete().like('name', 'Zona Registro E2E %');
});

test.describe('leitores Zela Pass e ponto somente registro (UI)', () => {
  test('ponto register_only, criar leitor, codigo unico, revogar', async ({ page }) => {
    test.slow();
    await loginOk(page, 'alfa.dono@example.test');

    // Zona própria do teste (a do seed pode não existir)
    await goMenu(page, { name: 'Zonas', exact: true });
    await page.getByRole('button', { name: 'Novo' }).click();
    await page.getByLabel('Nome', { exact: true }).fill(ZONE);
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('cell', { name: ZONE })).toBeVisible();

    // Ponto somente registro
    await goMenu(page, { name: 'Pontos de acesso' });
    await page.getByRole('button', { name: 'Novo' }).click();
    const form = page.getByRole('dialog', { name: 'Novo ponto de acesso' });
    await expect(form.getByLabel('Modo do ponto')).toHaveValue('driver'); // padrao: comportamento anterior
    await form.getByLabel('Zona').selectOption({ label: ZONE });
    await form.getByLabel('Nome', { exact: true }).fill(POINT);
    await form.getByLabel('Modo do ponto').selectOption('none');
    await expect(form.getByText('nunca envia comando para porta')).toBeVisible();
    await form.getByRole('button', { name: 'Salvar' }).click();
    const pointRow = page.getByRole('row', { name: new RegExp(POINT) });
    await expect(pointRow.getByRole('cell', { name: 'Somente registro' })).toBeVisible();

    // Leitor: o codigo aparece uma vez, com QR
    await goMenu(page, { name: 'Leitores Zela Pass' });
    await page.getByRole('button', { name: 'Novo' }).click();
    const create = page.getByRole('dialog', { name: 'Novo leitor' });
    await create
      .getByLabel('Ponto de acesso')
      .selectOption({ label: `${POINT} — Somente registro (sem atuar)` });
    await create.getByLabel('Nome do leitor').fill(READER);
    await create.getByRole('button', { name: 'Criar leitor' }).click();
    const code = page.getByRole('dialog', { name: 'Código de ativação' });
    const text = (await code.locator('code').innerText()).trim();
    expect(text).toMatch(/^zrd_[0-9a-f]{64}$/);
    await expect(code.getByRole('img', { name: 'QR code' })).toBeVisible();
    await code.getByRole('button', { name: 'Já anotei' }).click();

    // Depois de fechar, o codigo nao existe mais em lugar nenhum da tela
    const row = page.getByRole('row', { name: new RegExp(READER) });
    await expect(row.getByRole('cell', { name: 'Aguardando ativação' })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'Somente registro' })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(text);
    await page.reload();
    expect(await page.locator('body').innerText()).not.toContain(text);

    // Revogar exige motivo
    await row.getByRole('button', { name: 'Revogar' }).click();
    const revoke = page.getByRole('dialog', { name: 'Revogar leitor' });
    await expect(revoke.getByRole('button', { name: 'Revogar leitor' })).toBeDisabled();
    await revoke.getByLabel('Motivo (mínimo 5 caracteres)').fill('tablet de teste E2E');
    await revoke.getByRole('button', { name: 'Revogar leitor' }).click();
    await expect(row.getByRole('cell', { name: 'Revogado', exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Revogar' })).toHaveCount(0);
  });

  test('seguranca le e revoga mas nao cria; visualizador nem enxerga a pagina', async ({
    page,
  }) => {
    await loginOk(page, 'alfa.seguranca@example.test');
    await goMenu(page, { name: 'Leitores Zela Pass' });
    await expect(page.getByRole('heading', { name: 'Leitores Zela Pass' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Novo' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Sair' }).click();

    await loginOk(page, 'alfa.visualizador@example.test');
    await expect(
      page.getByRole('link', { name: 'Leitores Zela Pass', includeHidden: true }),
    ).toHaveCount(0);
    await page.goto('/leitores');
    await expect(page.getByText('Você não tem permissão para ver esta página.')).toBeVisible();
  });

  test('outra organizacao nao ve os leitores da Alfa', async ({ page }) => {
    await loginOk(page, 'beta.dono@example.test');
    await goMenu(page, { name: 'Leitores Zela Pass' });
    await expect(page.getByRole('cell', { name: new RegExp('Tablet E2E') })).toHaveCount(0);
  });
});
