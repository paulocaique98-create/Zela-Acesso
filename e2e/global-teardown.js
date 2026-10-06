// Apaga as organizacoes de teste (slug e2e-*) do Supabase local ao fim da suite E2E.
import { spawnSync } from 'node:child_process';

export default function globalTeardown() {
  spawnSync('node', ['scripts/purge-tenants-dev.mjs', '--e2e', '--apply'], { stdio: 'inherit' });
}
