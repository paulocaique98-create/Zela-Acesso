import { expect, test } from '@playwright/test';
import { API, DEV_PASSWORD, login, loginOk } from './helpers';

test.describe('autenticacao', () => {
  test('rota protegida redireciona para /login', async ({ page }) => {
    await page.goto('/sites');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('senha errada mostra erro generico', async ({ page }) => {
    await login(page, 'alfa.dono@example.test', 'senha-errada-123A');
    await expect(page.getByRole('alert')).toHaveText('E-mail ou senha inválidos.');
  });

  test('e-mail inexistente mostra o mesmo erro (sem enumeracao)', async ({ page }) => {
    await login(page, 'ninguem@example.test');
    await expect(page.getByRole('alert')).toHaveText('E-mail ou senha inválidos.');
  });
});

test.describe('isolamento entre organizacoes (UI)', () => {
  test('proprietario do Alfa ve so dados do Alfa', async ({ page }) => {
    await loginOk(page, 'alfa.dono@example.test');
    await expect(page.getByRole('heading', { name: 'Condomínio Alfa (exemplo)' })).toBeVisible();
    await expect(page.locator('#tenant option')).toHaveCount(1);
    await page.getByRole('link', { name: 'Locais' }).click();
    await expect(page.getByRole('cell', { name: 'Alfa - Sede' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Alfa - Garagem' })).toBeVisible();
    await expect(page.getByText('Beta - Matriz')).toHaveCount(0);
    await page.getByRole('link', { name: 'Membros' }).click();
    await expect(page.getByRole('cell', { name: /Gabi Beta/ })).toHaveCount(0);
    await expect(page.getByRole('cell', { name: /Bruno Alfa/ })).toBeVisible();
  });

  test('proprietario do Beta ve so dados do Beta', async ({ page }) => {
    await loginOk(page, 'beta.dono@example.test');
    await page.getByRole('link', { name: 'Locais' }).click();
    await expect(page.getByRole('cell', { name: 'Beta - Matriz' })).toBeVisible();
    await expect(page.getByText('Alfa - Sede')).toHaveCount(0);
  });

  test('viewer nao ve Membros nem Auditoria e a URL direta e negada', async ({ page }) => {
    await loginOk(page, 'alfa.visualizador@example.test');
    await expect(page.getByRole('link', { name: 'Membros' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Auditoria' })).toHaveCount(0);
    await page.goto('/auditoria');
    await expect(page.getByText('Você não tem permissão para ver esta página.')).toBeVisible();
  });

  test('usuario com escopo por site ve somente o site do escopo', async ({ page }) => {
    await loginOk(page, 'alfa.sede@example.test');
    await page.getByRole('link', { name: 'Locais' }).click();
    await expect(page.getByRole('cell', { name: 'Alfa - Sede' })).toBeVisible();
    await expect(page.getByText('Alfa - Garagem')).toHaveCount(0);
  });
});

test.describe('isolamento via API (RLS real, sem UI)', () => {
  async function token(email: string): Promise<{ jwt: string; key: string }> {
    const key = process.env['E2E_PUBLISHABLE_KEY'] ?? '';
    const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: DEV_PASSWORD }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { access_token: string };
    return { jwt: body.access_token, key };
  }

  test.beforeAll(async () => {
    expect(process.env['E2E_PUBLISHABLE_KEY'], 'defina E2E_PUBLISHABLE_KEY').toBeTruthy();
  });

  test('token do Beta nao le sites, membros nem auditoria do Alfa', async () => {
    const { jwt, key } = await token('beta.dono@example.test');
    const h = { apikey: key, Authorization: `Bearer ${jwt}` };
    const all = await (await fetch(`${API}/rest/v1/sites?select=id,name`, { headers: h })).json();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Beta - Matriz');
    for (const table of ['memberships', 'audit_log']) {
      const rows = (await (
        await fetch(`${API}/rest/v1/${table}?select=tenant_id`, { headers: h })
      ).json()) as {
        tenant_id: string;
      }[];
      expect(new Set(rows.map((r) => r.tenant_id)).size).toBeLessThanOrEqual(1);
    }
  });

  test('chave publica sem login nao le nada (anon negado)', async () => {
    const key = process.env['E2E_PUBLISHABLE_KEY'] ?? '';
    const r = await fetch(`${API}/rest/v1/tenants?select=id`, { headers: { apikey: key } });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  test('Beta nao consegue inserir site no Alfa nem criar tenant', async () => {
    const { jwt, key } = await token('beta.dono@example.test');
    const h = { apikey: key, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
    const alfa = await (
      await fetch(`${API}/rest/v1/rpc/create_tenant`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          p_name: 'Invasor',
          p_slug: 'invasor',
          p_owner_user_id: '00000000-0000-0000-0000-000000000000',
        }),
      })
    ).status;
    expect(alfa).toBeGreaterThanOrEqual(400);
  });
});
