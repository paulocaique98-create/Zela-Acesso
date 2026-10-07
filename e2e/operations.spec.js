import { expect, test } from '@playwright/test';
import { loginOk, localAdmin } from './helpers.js';

// Fase 6C pela UI (organizacao Alfa do seed): alerta semeado pelo admin local -> reconhecer -> incidente -> resolver -> encerrar.
// Alertas nascem no servidor (sem insert pela UI); o teste semeia pelo admin do Supabase local descartavel e apaga tudo.
const stamp = Date.now();
const TITLE = `Incidente Ops E2E ${stamp}`;
const DEDUP = `e2e-ops-${stamp}`;
const admin = localAdmin();
let alertId = '';

async function cleanup() {
  await admin.from('alerts').delete().eq('dedup_key', DEDUP);
  await admin.from('incidents').delete().eq('title', TITLE);
}

test.describe('operacao: alertas e incidentes (Fase 6C, UI)', () => {
  test.afterAll(cleanup);

  test('reconhecer, abrir incidente, resolver, encerrar e isolar outra organizacao', async ({
    page,
    browser,
  }) => {
    test.slow();
    const { data: tenant } = await admin
      .from('tenants')
      .select('id')
      .eq('slug', 'alfa-exemplo')
      .single();
    const { data: site } = await admin
      .from('sites')
      .select('id')
      .eq('tenant_id', tenant?.id)
      .order('name')
      .limit(1)
      .single();
    const now = new Date().toISOString();
    const { data: seeded, error } = await admin
      .from('alerts')
      .insert({
        tenant_id: tenant?.id,
        site_id: site?.id,
        kind: 'door_forced',
        severity: 'critical',
        dedup_key: DEDUP,
        first_at: now,
        last_at: now,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    alertId = seeded?.id ?? '';
    expect(alertId).not.toBe('');

    await loginOk(page, 'alfa.dono@example.test');
    await page.getByRole('link', { name: 'Operação' }).click();
    const alerts = page.getByRole('table', { name: 'Alertas' });
    const row = alerts.getByRole('row', { name: /Porta forçada/ }).first();
    await expect(row.getByRole('cell', { name: 'Aberto' })).toBeVisible();

    // Reconhecer
    await row.getByRole('button', { name: 'Reconhecer' }).click();
    await expect(page.getByText('Alerta reconhecido.')).toBeVisible();
    await expect(row.getByRole('cell', { name: 'Reconhecido' })).toBeVisible();

    // Abrir incidente a partir do alerta
    await row.getByRole('button', { name: 'Abrir incidente' }).click();
    const dlg = page.getByRole('dialog', { name: 'Abrir incidente' });
    await dlg.getByLabel('Título').fill(TITLE);
    await dlg.getByRole('button', { name: 'Abrir incidente' }).click();
    await expect(page.getByText('Incidente aberto.')).toBeVisible();
    const incidents = page.getByRole('table', { name: 'Incidentes' });
    const inc = incidents.getByRole('row', { name: new RegExp(TITLE) });
    await expect(inc.getByRole('cell', { name: 'Aberto' })).toBeVisible();

    // Resolver o alerta
    await row.getByRole('button', { name: 'Resolver' }).click();
    await page
      .getByRole('dialog', { name: 'Resolver alerta' })
      .getByRole('button', { name: 'Confirmar' })
      .click();
    await expect(page.getByText('Alerta resolvido.')).toBeVisible();

    // Investigar e encerrar o incidente
    await inc.getByRole('button', { name: 'Investigar' }).click();
    await expect(inc.getByRole('cell', { name: 'Em investigação' })).toBeVisible();
    await inc.getByRole('button', { name: 'Encerrar' }).click();
    await page
      .getByRole('dialog', { name: 'Encerrar incidente' })
      .getByRole('button', { name: 'Confirmar' })
      .click();
    await expect(page.getByText('Incidente encerrado.')).toBeVisible();
    await expect(inc.getByRole('cell', { name: 'Encerrado' })).toBeVisible();

    // Isolamento: outra organizacao nao ve o incidente
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await loginOk(other, 'beta.dono@example.test');
    await other.getByRole('link', { name: 'Operação' }).click();
    await expect(other.getByRole('heading', { name: 'Incidentes' })).toBeVisible();
    await expect(other.getByText(TITLE)).toHaveCount(0);
    await ctx.close();
  });
});
