import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// A chave publica vem de apps/web/.env.local (gerado por scripts/write-web-env.mjs).
try {
  const m = /^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/m.exec(
    readFileSync('apps/web/.env.local', 'utf8'),
  );
  if (m?.[1]) process.env['E2E_PUBLISHABLE_KEY'] ??= m[1].trim();
} catch {
  /* sem .env.local: os testes de API falham com mensagem clara */
}

// Executa contra localhost (127.0.0.1:55173) + Supabase local do Zela Acesso (127.0.0.1:55321).
export default defineConfig({
  testDir: './e2e',
  // Testes de um arquivo rodam em sequencia (compartilham estado: logo global, conversas); arquivos em paralelo.
  fullyParallel: false,
  workers: 2,
  globalSetup: './e2e/global-setup.js',
  retries: 0,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:55173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @zela/web dev',
    url: 'http://127.0.0.1:55173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
