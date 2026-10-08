import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { DEV_PASSWORD, apiRpc, createTestOrg, localAdmin, loginOk, goMenu } from './helpers.js';

// Fase 9B: cadastro TOTP, desafio no login e exigencia por organizacao. Organizacao e usuario sao e2e-*/exclusivos
// e saem no purge do teardown. O TOTP e gerado aqui (RFC 6238, SHA-1, 30 s, 6 digitos) a partir do segredo exibido.
const admin = localAdmin();

function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret, offsetSteps = 0) {
  const counter = Math.floor(Date.now() / 30_000) + offsetSteps;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

test.describe('MFA TOTP (Fase 9B)', () => {
  test('cadastra fator, exige no login e a exigencia por organizacao bloqueia sem aal2', async ({
    page,
  }) => {
    test.slow();
    const org = await createTestOrg('Org MFA');
    const email = `mfa.${Date.now()}@example.test`;
    const created = await admin.auth.admin.createUser({
      email,
      password: DEV_PASSWORD,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    const userId = /** @type {string} */ (created.data.user?.id);
    const ins = await admin
      .from('memberships')
      .insert({ tenant_id: org.id, user_id: userId, role: 'organization_owner' });
    expect(ins.error).toBeNull();

    await loginOk(page, email);
    await goMenu(page, { name: 'Membros' });
    await page.getByRole('button', { name: 'Cadastrar segundo fator' }).click();
    await page.getByText('Não consigo ler o QR code').click();
    const secret = (await page.locator('details code').innerText()).trim();
    await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
    await page.getByRole('button', { name: 'Ativar' }).click();
    await expect(page.getByRole('button', { name: 'Exigir MFA dos administradores' })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Exigir MFA dos administradores' }).click();
    await expect(page.getByText('ligada')).toBeVisible();

    // Novo login: pede o desafio; codigo errado e recusado; o certo entra.
    await page.getByRole('button', { name: 'Sair' }).click();
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill(DEV_PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('heading', { name: 'Confirme seu segundo fator' })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByLabel(/Código de 6 dígitos/).fill('000000');
    await page.getByRole('button', { name: 'Verificar' }).click();
    await expect(page.getByRole('alert')).toContainText('inválido');
    await page.getByLabel(/Código de 6 dígitos/).fill(totp(secret));
    await page.getByRole('button', { name: 'Verificar' }).click();
    await expect(page.getByRole('link', { name: 'Membros', includeHidden: true })).toBeAttached({ timeout: 15_000 });

    // Sessao aal1 (so senha) chamando a API direto: o banco nega mesmo sem a UI.
    const r = await fetch('http://127.0.0.1:55321/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: {
        apikey: process.env['E2E_PUBLISHABLE_KEY'] ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password: DEV_PASSWORD }),
    });
    const aal1Token = (await r.json()).access_token;
    const denied = await apiRpc(aal1Token, 'set_tenant_mfa_required', {
      p_tenant: org.id,
      p_required: false,
    });
    expect(denied.status).toBeGreaterThanOrEqual(400);
    const still = await admin.from('tenants').select('mfa_required').eq('id', org.id).single();
    expect(still.data?.mfa_required).toBe(true);
  });

  test('codigos de recuperacao: gera, usa no desafio, refaz o cadastro; remover fator', async ({
    page,
  }) => {
    test.slow();
    const org = await createTestOrg('Org MFA Rec');
    const email = `mfa.rec.${Date.now()}@example.test`;
    const created = await admin.auth.admin.createUser({
      email,
      password: DEV_PASSWORD,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    const userId = /** @type {string} */ (created.data.user?.id);
    const ins = await admin
      .from('memberships')
      .insert({ tenant_id: org.id, user_id: userId, role: 'organization_owner' });
    expect(ins.error).toBeNull();

    await loginOk(page, email);
    await goMenu(page, { name: 'Membros' });
    await page.getByRole('button', { name: 'Cadastrar segundo fator' }).click();
    await page.getByText('Não consigo ler o QR code').click();
    const secret = (await page.locator('details code').innerText()).trim();
    await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
    await page.getByRole('button', { name: 'Ativar' }).click();
    await page.getByRole('button', { name: 'Gerar códigos de recuperação' }).click();
    const first = (await page.locator('[role=status] li').first().innerText()).trim();
    expect(first).toMatch(/^[A-Z2-9]{10}$/);
    await expect(page.getByText('Códigos de recuperação válidos: 8.')).toBeVisible();
    await page.getByRole('button', { name: 'Exigir MFA dos administradores' }).click();
    await expect(page.getByText('ligada')).toBeVisible();

    // Novo login: usa o codigo de recuperacao, o fator e removido e a pessoa cadastra outro.
    await page.getByRole('button', { name: 'Sair' }).click();
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill(DEV_PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.getByRole('button', { name: 'Usar código de recuperação' }).click();
    await page.getByLabel('Código de recuperação').fill('AAAAAAAAAA');
    await page.getByRole('button', { name: 'Recuperar' }).click();
    await expect(page.getByRole('alert')).toContainText('inválido');
    await page.getByLabel('Código de recuperação').fill(first);
    await page.getByRole('button', { name: 'Recuperar' }).click();
    await expect(page.getByRole('heading', { name: 'Cadastre o segundo fator' })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByText('Não consigo ler o QR code').click();
    const secret2 = (await page.locator('details code').innerText()).trim();
    await page.getByLabel('Código de 6 dígitos').fill(totp(secret2));
    await page.getByRole('button', { name: 'Ativar' }).click();
    await expect(page.getByRole('link', { name: 'Membros', includeHidden: true })).toBeAttached({ timeout: 15_000 });

    // Codigo ja usado nao existe mais (todos foram apagados no uso).
    const left = await admin.from('mfa_recovery_codes').select('id').eq('user_id', userId);
    expect(left.data).toEqual([]);

    // Remover o fator pela tela (sessao aal2).
    await goMenu(page, { name: 'Membros' });
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Remover segundo fator' }).click();
    await expect(page.getByRole('button', { name: 'Cadastrar segundo fator' })).toBeVisible({
      timeout: 15_000,
    });
    const audit = await admin
      .from('audit_log')
      .select('action')
      .eq('actor_user_id', userId)
      .eq('action', 'auth.mfa_factor_removed');
    expect(audit.data?.length).toBe(2); // uso do codigo de recuperacao + remocao pela tela
  });
});
