import { expect, test } from '@playwright/test';
import { createTestOrg, localAdmin, loginOk, goMenu } from './helpers.js';

// Fase 7C pela UI (organizacao de teste e2e-*, apagada pelo global-teardown): politica -> cadastro guiado ->
// revogacao -> isolamento. Consentimentos sao append-only; a limpeza e o purge de tenants e2e-* (replica role).
const PERSON = `Pessoa Bio E2E ${Date.now()}`;
const admin = localAdmin();

test.describe('biometria: politica, consentimento e perfil (Fase 7C, UI)', () => {
  test('liga a politica, cadastra, revoga e isola outra organizacao', async ({ page, browser }) => {
    test.slow();
    const org = await createTestOrg('Org Biometria');
    const { error: fe } = await admin
      .from('tenants')
      .update({ features_enabled: { sites: true, people: true, members: true, biometrics: true } })
      .eq('id', org.id);
    expect(fe).toBeNull();
    const { error: pe } = await admin
      .from('people')
      .insert({ tenant_id: org.id, full_name: PERSON, kind: 'employee' });
    expect(pe).toBeNull();

    await loginOk(page, 'responsavel.teste@example.test');
    await page.locator('#tenant').selectOption({ label: org.name });
    await goMenu(page, { name: 'Biometria' });
    await expect(page.getByRole('heading', { name: 'Biometria', exact: true })).toBeVisible();
    await expect(page.getByText('Biometria desligada (padrão).')).toBeVisible();

    // Politica
    await page.getByRole('button', { name: 'Configurar política' }).click();
    const policy = page.getByRole('dialog', { name: 'Política de biometria' });
    await policy.getByLabel('Biometria ligada nesta organização').check();
    await policy.getByLabel('Versão do aviso de privacidade apresentado').fill('v1');
    await policy.getByLabel('Contato do encarregado (DPO)').fill('dpo@e2e.test');
    await policy.getByLabel('Versão do RIPD').fill('ripd-1');
    await policy.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Política de biometria salva.')).toBeVisible();
    await expect(page.getByText('Retenção: 365 dias')).toBeVisible();

    // Cadastro guiado: so habilita com as tres confirmacoes
    await page.getByRole('button', { name: 'Cadastrar biometria' }).click();
    const enroll = page.getByRole('dialog', { name: 'Cadastro biométrico guiado' });
    await enroll.getByLabel(/Pessoa/).selectOption({ label: PERSON });
    const submit = enroll.getByRole('button', { name: 'Cadastrar biometria' });
    await expect(submit).toBeDisabled();
    await enroll.getByLabel(/recebeu o aviso de privacidade/).check();
    await enroll.getByLabel(/alternativa não biométrica/).check();
    await expect(submit).toBeDisabled();
    await enroll.getByLabel(/maior de 18 anos/).check();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText('Biometria cadastrada.')).toBeVisible();
    const table = page.getByRole('table', { name: 'Perfis biométricos' });
    const row = table.getByRole('row', { name: new RegExp(PERSON) });
    await expect(row.getByRole('cell', { name: 'Ativo' })).toBeVisible();

    // Revogacao: credencial revogada e eliminacao pendente
    await row.getByRole('button', { name: 'Revogar' }).click();
    await page
      .getByRole('dialog', { name: 'Revogar biometria' })
      .getByRole('button', { name: 'Revogar' })
      .click();
    await expect(page.getByText('Biometria revogada.')).toBeVisible();
    await expect(row.getByRole('cell', { name: 'Revogado' })).toBeVisible();
    await expect(row.getByText('Solicitada (aguardando provedor)')).toBeVisible();
    const { data: creds } = await admin
      .from('credentials')
      .select('status')
      .eq('tenant_id', org.id)
      .eq('type', 'biometric');
    expect(creds?.map((c) => c.status)).toEqual(['revoked']);
    const { data: prof } = await admin
      .from('biometric_profiles')
      .select('template_ref')
      .eq('tenant_id', org.id);
    expect(prof?.[0]?.template_ref).toMatch(/^mock:/); // referencia segue ate o provedor confirmar a eliminacao

    // Isolamento: outra organizacao (sem o modulo) nao ve nada
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await loginOk(other, 'beta.dono@example.test');
    await other.goto('/biometria');
    await expect(other.getByText('O módulo de biometria não está contratado')).toBeVisible();
    await expect(other.getByText(PERSON)).toHaveCount(0);
    await ctx.close();
  });
});
