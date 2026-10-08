// E2E de NAVEGADOR do Zela Pass: Chromium real + PWA construído + Edge real em processo (serviço do leitor, HTTP e WebSocket),
// sem banco (snapshot sintético). Cobre: ativação, quiosque, senha, leitor-teclado (barras/QR), configurações, revogação,
// Edge fora do ar, política de segurança de conteúdo (CSP) e persistência da identidade.
//   pnpm --filter @zela/reader build && node apps/reader/e2e/reader.browser.mjs
// Capturas de tela em SHOT_DIR (padrão: pasta temporária).
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createReaderHttpServer } from '../../edge-agent/src/reader-http-server.js';
import { createReaderService } from '../../edge-agent/src/reader-service.js';
import { applySnapshot } from '../../edge-agent/src/snapshot.js';
import { openStore } from '../../edge-agent/src/store.js';
import {
  ANA_CARD,
  ANA_PIN,
  ANA_REF,
  ENROLL_CODE,
  IDS,
  makeSnapshot,
} from '../../edge-agent/src/fixtures.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const SHOTS = process.env.SHOT_DIR ?? join(tmpdir(), 'zela-pass-shots');
mkdirSync(SHOTS, { recursive: true });
const TOKEN = 'ab'.repeat(32); // token móvel: 64 hex, como o emitido pelo banco
const OPERATOR_PIN = '582931';

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    await page.screenshot({ path: join(SHOTS, `falha-${results.length}.png`) }).catch(() => {});
    results.push(['FAIL', `${name} — ${String(e.message).split('\n')[0]}`]);
  }
};

// ---- Edge em processo
const store = openStore();
store.setMeta('clock_drift_s', '0');
store.setMeta('clock_checked_at', new Date().toISOString());
const reader = (over = {}) => ({
  id: IDS.reader,
  accessPointId: IDS.registerPoint,
  status: 'pending',
  enrollmentTokenHash: sha256(ENROLL_CODE),
  enrollmentExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  ...over,
});
const load = (readers) => {
  const snap = makeSnapshot({ readers });
  snap.policies[0].scheduleId = null; // vale em qualquer dia/hora (a janela de segunda-feira não importa aqui)
  const tok = snap.credentials.find((c) => c.type === 'mobile_token');
  tok.secretHash = sha256(TOKEN);
  tok.expiresAt = '2099-01-01T00:00:00Z';
  applySnapshot(store, { hash: `h${Math.random()}`, snapshot: snap }, new Date());
};
load([reader()]);
const service = createReaderService({ store, isOffline: () => false });
let http = createReaderHttpServer({
  service,
  bind: '127.0.0.1',
  port: 0,
  webDir: resolve('apps/reader/dist'),
});
const { port } = await http.listen();
const base = `http://127.0.0.1:${port}`;
const queued = () => store.dueEvents('9999-01-01T00:00:00Z').map((d) => d.payload);

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const ctx = await browser.newContext({
  viewport: { width: 1024, height: 768 },
  permissions: ['camera'],
  serviceWorkers: 'allow',
});
const page = await ctx.newPage();
page.setDefaultTimeout(6000);
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = (n) => page.screenshot({ path: join(SHOTS, `${n}.png`) });
const text = (t) => page.getByText(t, { exact: false });

try {
  await step('abre a tela de ativação com marca Zela Pass', async () => {
    await page.goto(base);
    await text('Ativar este leitor').waitFor();
    assert.equal(await page.title(), 'Zela Pass');
    await shot('01-ativacao');
  });

  await step('código inválido mostra erro genérico e não ativa', async () => {
    await page.getByLabel('Código de ativação', { exact: true }).fill(`zrd_${'cd'.repeat(32)}`);
    await page.getByLabel('PIN do operador (6 a 8 dígitos)').fill(OPERATOR_PIN);
    await page.getByLabel('Repita o PIN do operador').fill(OPERATOR_PIN);
    await page.getByRole('button', { name: 'Ativar leitor' }).click();
    await text('Código inválido, expirado ou já usado').waitFor();
  });

  await step('PIN do operador previsível é recusado antes de enviar', async () => {
    await page.getByLabel('Código de ativação', { exact: true }).fill(ENROLL_CODE);
    await page.getByLabel('PIN do operador (6 a 8 dígitos)').fill('123456');
    await page.getByLabel('Repita o PIN do operador').fill('123456');
    await page.getByRole('button', { name: 'Ativar leitor' }).click();
    await text('PIN muito previsível').waitFor();
  });

  await step('ativa com o código correto e abre o quiosque', async () => {
    await page.getByLabel('Nome deste aparelho (opcional)').fill('Tablet da portaria');
    await page.getByLabel('PIN do operador (6 a 8 dígitos)').fill(OPERATOR_PIN);
    await page.getByLabel('Repita o PIN do operador').fill(OPERATOR_PIN);
    await page.getByRole('button', { name: 'Ativar leitor' }).click();
    await text('Bem-vindo').first().waitFor();
    await page.getByLabel('Hora atual').waitFor();
    assert.ok(store.getReader(IDS.reader), 'o Edge deve ter registrado a chave pública');
    await text('Somente registro').first().waitFor();
    await page.waitForTimeout(500);
    await shot('02-quiosque');
  });

  await step('a identidade fica guardada (recarregar não pede ativação)', async () => {
    load([reader({ status: 'active', enrollmentTokenHash: null })]);
    await page.reload();
    await text('Bem-vindo').first().waitFor();
    assert.equal(await text('Ativar este leitor').count(), 0);
  });

  await step('senha: registra a marcação e mostra "Registrado" + sentido', async () => {
    await page.getByRole('button', { name: 'Teclado' }).click();
    await page.getByLabel('Nº identificador').fill(ANA_REF);
    await page.getByLabel('Senha', { exact: true }).fill(ANA_PIN);
    await shot('03-teclado');
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await text('Registrado').first().waitFor();
    await text('Entrada').first().waitFor();
    await shot('04-resultado-registrado');
  });

  await step('senha errada: "Credencial inválida", nada é aceito', async () => {
    await page.getByRole('button', { name: /Registrado/ }).click(); // fecha a resposta
    await page.getByRole('button', { name: 'Teclado' }).click();
    await page.getByLabel('Nº identificador').fill(ANA_REF);
    await page.getByLabel('Senha', { exact: true }).fill('111222');
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await text('Credencial inválida').first().waitFor();
    await shot('05-resultado-recusado');
  });

  await step('leitor USB/Bluetooth (teclado): código de barras e QR', async () => {
    await page.getByRole('button', { name: /Credencial inválida/ }).click();
    await text('Bem-vindo').first().waitFor();
    await page.keyboard.type(ANA_CARD, { delay: 5 });
    await page.keyboard.press('Enter');
    await text('Registrado').first().waitFor();
    await page.getByRole('button', { name: /Registrado/ }).click();
    await text('Bem-vindo').first().waitFor();
    await page.keyboard.type(TOKEN, { delay: 2 });
    await page.keyboard.press('Enter');
    await text('Registrado').first().waitFor();
    await page.getByRole('button', { name: /Registrado/ }).click();
  });

  await step('câmera: tela de leitura abre e aceita código digitado', async () => {
    await page.getByRole('button', { name: /QR Code \/ Barras/ }).click();
    await text('Aproxime o QR Code').waitFor();
    await page.waitForTimeout(800);
    await shot('06-leitura-camera');
    await page.getByLabel('Digitar o código').fill(ANA_CARD);
    await page.getByRole('button', { name: 'Enviar' }).click();
    await text('Registrado').first().waitFor();
    await page.getByRole('button', { name: /Registrado/ }).click();
  });

  await step(
    'a nuvem recebe só evidência: 4 marcações aceitas, 1 recusada, sem segredo',
    async () => {
      const ev = queued();
      assert.equal(
        ev.filter((e) => e.p_decision === 'ALLOW').length,
        4,
        JSON.stringify(ev.map((e) => e.p_decision)),
      );
      assert.equal(ev.filter((e) => e.p_decision === 'DENY').length, 1);
      assert.deepEqual([...new Set(ev.map((e) => e.p_evidence.reader.method))].sort(), [
        'barcode',
        'pin',
        'qr',
      ]);
      const all = JSON.stringify(ev);
      for (const s of [ANA_PIN, TOKEN, ANA_CARD, '111222', OPERATOR_PIN])
        assert.ok(!all.includes(s), 'segredo na evidência');
    },
  );

  await step('configurações: PIN do operador errado e certo', async () => {
    await page.getByRole('button', { name: 'Configurações' }).click();
    await page.getByLabel('PIN do operador', { exact: true }).fill('000000');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await text('PIN incorreto').waitFor();
    await page.getByLabel('PIN do operador', { exact: true }).fill(OPERATOR_PIN);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await text('Bem-vindo às configurações').waitFor();
    await shot('07-menu-configuracoes');
  });

  await step('Informações do Sistema', async () => {
    await page.getByRole('button', { name: 'Informações do Sistema' }).click();
    await text('Versão do aplicativo').waitFor();
    await text('Somente registro').first().waitFor();
    await shot('08-informacoes');
    await page.getByRole('button', { name: 'Voltar' }).click();
  });

  await step('Registros: sem nome nem valor lido; todas entregues', async () => {
    await page.getByRole('button', { name: 'Registros', exact: true }).click();
    await text('Todas as leituras foram entregues ao Edge').waitFor();
    const body = await page.locator('body').innerText();
    assert.ok(
      body.includes('Senha') && body.includes('QR Code') && body.includes('Código de barras'),
    );
    for (const s of [ANA_PIN, ANA_CARD, TOKEN, 'Ana'])
      assert.ok(!body.includes(s), `tela mostra ${s}`);
    await shot('09-registros');
    await page.getByRole('button', { name: 'Voltar' }).click();
  });

  await step(
    'Configurações do Sistema: testar conexão e TCP indisponível no navegador',
    async () => {
      await page.getByRole('button', { name: 'Configurações do Sistema' }).click();
      await page.getByRole('button', { name: 'Testar conexão' }).click();
      await text('Conectado ao Edge').waitFor();
      assert.equal(await page.locator('option[value="tcp"]').evaluate((o) => o.disabled), true);
      await shot('10-configuracoes-sistema');
      await page.getByRole('button', { name: 'Voltar' }).click();
      await page.getByRole('button', { name: 'Sair' }).click();
      await text('Bem-vindo').first().waitFor();
    },
  );

  await step('leitor revogado na nuvem: aviso e leituras recusadas', async () => {
    load([]); // some do snapshot
    await page.keyboard.type('ZZ99XX88', { delay: 5 });
    await page.keyboard.press('Enter');
    await text('Leitor revogado').first().waitFor();
    await shot('11-revogado');
    await page.getByRole('button', { name: /Leitor revogado/ }).click();
    await text('Este leitor foi revogado').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Teclado' }).isDisabled(), true);
    load([reader({ status: 'active', enrollmentTokenHash: null })]); // reativa para o próximo passo
  });

  await step(
    'Edge fora do ar: "Sem conexão com o Edge" e nada fica gravado no aparelho',
    async () => {
      await http.close();
      await page.reload();
      await text('Bem-vindo').first().waitFor();
      await page.keyboard.type('YY77WW66', { delay: 5 });
      await page.keyboard.press('Enter');
      await text('Sem conexão com o Edge').first().waitFor();
      await shot('12-edge-fora');
      // volta o Edge na MESMA porta para o passo seguinte
      http = createReaderHttpServer({
        service,
        bind: '127.0.0.1',
        port,
        webDir: resolve('apps/reader/dist'),
      });
      await http.listen();
    },
  );

  await step('desativar apaga a identidade e volta à ativação', async () => {
    await page.reload();
    await text('Bem-vindo').first().waitFor();
    await page.getByRole('button', { name: 'Configurações' }).click();
    await page.getByLabel('PIN do operador', { exact: true }).fill(OPERATOR_PIN);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.getByRole('button', { name: 'Configurações do Sistema' }).click();
    await page.getByRole('button', { name: 'Desativar', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await text('Ativar este leitor').waitFor();
    await page.reload();
    await text('Ativar este leitor').waitFor();
  });

  await step('nenhum erro de console nem violação de CSP durante todo o fluxo', async () => {
    const real = consoleErrors.filter(
      (e) => !/Failed to load resource|net::ERR|503|401|403|ERR_CONNECTION/.test(e),
    );
    assert.deepEqual(real, []);
  });
} finally {
  await browser.close();
  await http.close();
}

for (const [s, n] of results) process.stdout.write(`${s}  ${n}\n`);
process.stdout.write(`capturas em ${SHOTS}\n`);
if (results.some(([s]) => s === 'FAIL')) process.exit(1);
