// E2E de NAVEGADOR do facial do Zela Pass: Chromium real + PWA de produção (dist) servido pelo Edge real em processo,
// com o provedor facial de verdade (Human + SFace no navegador; gabarito cifrado e comparação no Edge). Sem banco
// (snapshot sintético). A câmera é simulada por um MediaStream alimentado por fotos (troca a cada passo), então todo o
// caminho getUserMedia -> <video> -> detecção -> alinhamento -> vetor -> envelope assinado -> Edge é o de produção.
//   pnpm --filter @zela/reader build && node scripts/fetch-face-models.mjs
//   FACE_E2E_DIR=<pasta> node apps/reader/e2e/face.browser.mjs
// A pasta tem: ana1.jpg e ana2.jpg (mesma pessoa), bob.jpg (outra pessoa). As fotos NÃO ficam no repositório.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { FACE_PROVIDER_KIND } from '../../../packages/biometrics/src/index.js';
import { createEdgeFaceProvider } from '../../edge-agent/src/face-provider.js';
import { createReaderHttpServer } from '../../edge-agent/src/reader-http-server.js';
import { createReaderService } from '../../edge-agent/src/reader-service.js';
import { applySnapshot } from '../../edge-agent/src/snapshot.js';
import { openStore } from '../../edge-agent/src/store.js';
import { ENROLL_CODE, IDS, makeSnapshot } from '../../edge-agent/src/fixtures.js';

const DIR = process.env.FACE_E2E_DIR;
const need = ['ana1.jpg', 'ana2.jpg', 'bob.jpg'];
if (!DIR || need.some((f) => !existsSync(join(DIR, f)))) {
  console.error(
    `E2E facial: defina FACE_E2E_DIR com ${need.join(', ')} (fotos nítidas, de frente).`,
  );
  process.exit(2);
}
if (!existsSync(resolve('apps/reader/dist/models/sface.onnx'))) {
  console.error(
    'E2E facial: rode `node scripts/fetch-face-models.mjs` e `pnpm --filter @zela/reader build`.',
  );
  process.exit(2);
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const SHOTS = process.env.SHOT_DIR ?? join(tmpdir(), 'zela-face-shots');
mkdirSync(SHOTS, { recursive: true });
const OPERATOR_PIN = '582931';
const PROFILE = '0a1b2c3d-0000-4000-8000-000000000001';
const REF = 'face:7e7e7e7e-1111-4222-8333-444455556666'; // a referência NÃO é o código de captura
const CODE = '0a1b2c3d';
const BIO_CRED = 'a0000000-0000-0000-0000-0000000000b1';

const results = [];
let page;
const step = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    await page?.screenshot({ path: join(SHOTS, `falha-${results.length}.png`) }).catch(() => {});
    results.push(['FAIL', `${name} — ${String(e.message).split('\n')[0]}`]);
  }
};

// ---- Edge em processo, com o provedor facial real
const store = openStore();
store.setMeta('clock_drift_s', '0');
store.setMeta('clock_checked_at', new Date().toISOString());
const provider = createEdgeFaceProvider({ store });
const load = (status = 'pending') => {
  const snap = makeSnapshot({
    readers: [
      {
        id: IDS.reader,
        accessPointId: IDS.registerPoint,
        status,
        enrollmentTokenHash: status === 'pending' ? sha256(ENROLL_CODE) : null,
        enrollmentExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    ],
  });
  snap.policies[0].scheduleId = null;
  snap.credentials.push({
    id: BIO_CRED,
    personId: IDS.ana,
    type: 'biometric',
    status: 'active',
    secretHash: null,
    identifierHash: null,
    expiresAt: null,
  });
  snap.biometric = {
    settings: {
      enabled: true,
      legalBasis: 'fraud_prevention_security',
      retentionDays: 365,
      noticeVersion: 'v1',
      dpoContact: 'dpo@exemplo.com',
      ripdVersion: 'r1',
      ripdNextReviewAt: new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10),
      threshold: 0.85,
      requireLiveness: true,
    },
    profiles: [
      {
        id: PROFILE,
        personId: IDS.ana,
        credentialId: BIO_CRED,
        provider: FACE_PROVIDER_KIND,
        templateRef: REF,
        status: 'active',
        retentionUntil: new Date(Date.now() + 300 * 86_400_000).toISOString(),
      },
    ],
    pendingErasure: [],
  };
  applySnapshot(store, { hash: `h${Math.random()}`, snapshot: snap }, new Date());
};
load();
const service = createReaderService({ store, biometricProvider: provider, isOffline: () => false });
const http = createReaderHttpServer({
  service,
  bind: '127.0.0.1',
  port: 0,
  webDir: resolve('apps/reader/dist'),
});
const { port } = await http.listen();
const base = `http://127.0.0.1:${port}`;
const queued = () => store.dueEvents('9999-01-01T00:00:00Z').map((d) => d.payload);

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 1024, height: 768 },
  serviceWorkers: 'allow',
});
// Câmera simulada: MediaStream de um canvas que desenha a "pessoa" escolhida em window.__who (recorte 4:3, topo).
await ctx.addInitScript(() => {
  window.__imgs = {};
  window.__who = 'ana1';
  window.__denyCamera = false;
  navigator.mediaDevices.getUserMedia = async () => {
    if (window.__denyCamera) throw Object.assign(new Error('negado'), { name: 'NotAllowedError' });
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const g = c.getContext('2d');
    const draw = () => {
      const img = window.__imgs[window.__who];
      g.fillStyle = '#222';
      g.fillRect(0, 0, 640, 480);
      if (img) {
        const s = 640 / img.naturalWidth; // largura total, alinhado ao topo (rosto fica na parte de cima)
        g.drawImage(img, 0, 0, 640, img.naturalHeight * s);
      }
    };
    draw();
    setInterval(draw, 66);
    return c.captureStream(15);
  };
});
page = await ctx.newPage();
page.setDefaultTimeout(120_000);
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/onnxruntime/i.test(m.text())) consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = (n) => page.screenshot({ path: join(SHOTS, `${n}.png`) });
const text = (t) => page.getByText(t, { exact: false });
const useFace = (who) => page.evaluate((w) => (window.__who = w), who);
const loadImgs = () =>
  page.evaluate(
    async (files) => {
      for (const [name, url] of Object.entries(files)) {
        const img = new Image();
        img.src = url;
        await img.decode();
        window.__imgs[name] = img;
      }
    },
    Object.fromEntries(
      need.map((f) => [
        f.replace('.jpg', ''),
        `data:image/jpeg;base64,${readFileSync(join(DIR, f)).toString('base64')}`,
      ]),
    ),
  );

try {
  await step('ativa o leitor e o Edge informa que o facial está disponível', async () => {
    await page.goto(base);
    await loadImgs();
    await page.getByLabel('Código de ativação', { exact: true }).fill(ENROLL_CODE);
    await page.getByLabel('PIN do operador (6 a 8 dígitos)').fill(OPERATOR_PIN);
    await page.getByLabel('Repita o PIN do operador').fill(OPERATOR_PIN);
    await page.getByRole('button', { name: 'Ativar leitor' }).click();
    await text('Bem-vindo').first().waitFor();
    load('active');
    await page.reload();
    await loadImgs();
    await page.getByRole('button', { name: 'Facial' }).waitFor();
    await shot('01-home-com-facial');
  });

  await step('sem gabarito cadastrado, o rosto é recusado (nada é aceito por padrão)', async () => {
    await useFace('ana1');
    await page.getByRole('button', { name: 'Facial' }).click();
    await text('Credencial inválida').first().waitFor();
    await page.getByRole('button', { name: /Credencial inválida/ }).click();
  });

  await step('câmera negada mostra orientação e não envia nada', async () => {
    const before = queued().length;
    await page.evaluate(() => (window.__denyCamera = true));
    await page.getByRole('button', { name: 'Facial' }).click();
    await text('A câmera está bloqueada').waitFor();
    await shot('02-camera-negada');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await page.evaluate(() => (window.__denyCamera = false));
    assert.equal(queued().length, before);
  });

  await step(
    'operador cadastra o rosto pelo código de captura (menu protegido por PIN)',
    async () => {
      await page.getByRole('button', { name: 'Configurações' }).click();
      await page.getByLabel('PIN do operador', { exact: true }).fill(OPERATOR_PIN);
      await page.getByRole('button', { name: 'Entrar' }).click();
      await page.getByRole('button', { name: 'Cadastro facial' }).click();
      await page.getByLabel('Código de captura').fill(CODE);
      await useFace('ana1');
      await page.getByRole('button', { name: 'Capturar o rosto' }).click();
      await shot('03-captura');
      await text('Rosto cadastrado').waitFor();
      assert.equal(store.hasFaceTemplate(REF), true, 'o Edge deve ter guardado o gabarito');
      await page.getByRole('button', { name: 'Concluir' }).click();
      await page.getByRole('button', { name: 'Sair' }).click();
    },
  );

  await step('o mesmo código não cadastra de novo (não sobrescreve)', async () => {
    await page.getByRole('button', { name: 'Configurações' }).click();
    await page.getByLabel('PIN do operador', { exact: true }).fill(OPERATOR_PIN);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.getByRole('button', { name: 'Cadastro facial' }).click();
    await page.getByLabel('Código de captura').fill(CODE);
    await useFace('bob');
    await page.getByRole('button', { name: 'Capturar o rosto' }).click();
    await text('Código não encontrado ou já utilizado').waitFor();
    await page.getByRole('button', { name: 'Concluir' }).click();
    await page.getByRole('button', { name: 'Sair' }).click();
  });

  await step('a pessoa cadastrada, em outra foto, é reconhecida e registrada', async () => {
    await useFace('ana2');
    await page.getByRole('button', { name: 'Facial' }).click();
    await shot('04-reconhecendo');
    await text('Registrado').first().waitFor();
    await shot('05-registrado');
    await page.getByRole('button', { name: /Registrado/ }).click();
  });

  await step('outra pessoa é recusada como credencial inválida', async () => {
    await useFace('bob');
    await page.getByRole('button', { name: 'Facial' }).click();
    await text('Credencial inválida').first().waitFor();
    await shot('06-recusado');
    await page.getByRole('button', { name: /Credencial inválida/ }).click();
  });

  await step('a nuvem recebe só evidência (sem vetor, imagem ou código de captura)', async () => {
    const ev = queued().filter((e) => e.p_evidence?.reader?.method === 'face');
    const allow = ev.filter((e) => e.p_decision === 'ALLOW');
    const deny = ev.filter((e) => e.p_decision === 'DENY');
    assert.equal(allow.length, 1, JSON.stringify(ev.map((e) => e.p_decision)));
    assert.ok(deny.length >= 2);
    assert.ok(allow[0].p_evidence.steps.includes('biometric:BIOMETRIC_MATCH'));
    assert.ok(
      deny.some((e) => e.p_evidence.steps.includes('biometric:BIOMETRIC_NO_MATCH')),
      'a recusa de rosto desconhecido deve registrar o motivo BIOMETRIC_NO_MATCH',
    );
    const blob = JSON.stringify(queued());
    assert.ok(!blob.includes(CODE), 'código de captura na evidência');
    assert.ok(!/"d":"[A-Za-z0-9+/]{100}/.test(blob), 'vetor na evidência');
    assert.ok(!blob.includes('data:image'), 'imagem na evidência');
  });

  await step('o aparelho não guarda imagem nem vetor (IndexedDB/localStorage)', async () => {
    const dump = await page.evaluate(async () => {
      const out = [JSON.stringify({ ...localStorage })];
      for (const { name } of await indexedDB.databases()) {
        const db = await new Promise((res, rej) => {
          const r = indexedDB.open(name);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        for (const s of db.objectStoreNames) {
          const rows = await new Promise((res) => {
            const q = db.transaction(s).objectStore(s).getAll();
            q.onsuccess = () => res(q.result);
            q.onerror = () => res([]);
          });
          out.push(JSON.stringify(rows, (k, v) => (v instanceof CryptoKey ? '[key]' : v)));
        }
      }
      return out.join('\n');
    });
    assert.ok(
      !/[A-Za-z0-9+/]{300}/.test(dump),
      'dado grande/biométrico no armazenamento do aparelho',
    );
    assert.ok(!dump.includes('data:image'));
  });

  await step('sem erros de console nem violação da política de conteúdo (CSP)', async () => {
    assert.deepEqual(consoleErrors, []);
  });
} finally {
  await browser.close();
  await http.close();
}

for (const [r, n] of results) console.error(`${r}  ${n}`);
const failed = results.filter(([r]) => r === 'FAIL').length;
console.error(`\n${results.length - failed}/${results.length} passos OK. Capturas em ${SHOTS}`);
process.exit(failed ? 1 : 0);
