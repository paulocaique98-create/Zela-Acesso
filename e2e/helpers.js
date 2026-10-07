import { spawnSync } from 'node:child_process';
import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Usuarios sinteticos criados por scripts/seed-dev.mjs (somente banco local descartavel).
export const DEV_PASSWORD = 'Zela-Dev-Local-1234';
export const API = 'http://127.0.0.1:55321';

/** @param {import('@playwright/test').Page} page @param {string} email @param {string} [password] */
export async function login(page, email, password = DEV_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** @param {import('@playwright/test').Page} page @param {string} email */
export async function loginOk(page, email) {
  await login(page, email);
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible({ timeout: 30_000 });
}

const publishableKey = () => process.env['E2E_PUBLISHABLE_KEY'] ?? '';

/** Token de acesso (password grant) de um usuario sintetico, para chamar a API REST como ele. */
export async function apiToken(email, password = DEV_PASSWORD) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: publishableKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(r.status).toBe(200);
  return (await r.json()).access_token;
}

/** Chama uma RPC como o usuario do token. @returns {Promise<{ status: number, body: unknown }>} */
export async function apiRpc(token, name, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey(),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

/** Cria uma organizacao de teste (como platform_owner) e devolve { id, name, slug }. */
export async function createTestOrg(label = 'Org E2E') {
  const token = await apiToken('plataforma.dono@example.test');
  const slug = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const name = `${label} ${slug}`;
  const r = await apiRpc(token, 'platform_create_tenant', {
    p_name: name,
    p_slug: slug,
    p_owner_user_id: null,
    p_owner_email: 'responsavel.teste@example.test',
    p_details: null,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { id: /** @type {string} */ (r.body), name, slug };
}

/** Cliente admin (service_role) SO do Supabase local descartavel; recusa qualquer outra API. */
export function localAdmin() {
  const st = spawnSync('supabase', ['status', '-o', 'env'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const env = Object.fromEntries(
    (st.stdout ?? '')
      .split('\n')
      .map((l) => /^([A-Z0-9_]+)="?(.*?)"?$/.exec(l.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
  if (env['API_URL'] !== API || !env['SERVICE_ROLE_KEY'])
    throw new Error('RECUSADO: API local do Zela Acesso nao encontrada.');
  return createClient(API, env['SERVICE_ROLE_KEY'], { auth: { persistSession: false } });
}
