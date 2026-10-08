// Benchmark do provedor facial (D-007): roda o MESMO motor do leitor (apps/reader/src/lib/face/engine.js) no
// Chromium sobre um diretório de fotos rotuladas e mede latência, detecção, separação genuínos x impostores
// (AUC, EER, FAR/FRR por limiar da escala do produto) e as pontuações de prova de vida.
// Uso: node scripts/bench-face.mjs <dir-fotos> <rotulos.json> [saida.json]
//   rotulos.json: { "img1.jpg": "pessoaA", ... } (todos contra todos) OU { "pairs": [{ "a": "x.jpg", "b": "y.jpg", "same": true }, ...] }
// BENCH_ENGINE=human-faceres compara com o descritor embutido do Human (1024 dims, cosseno puro) no mesmo conjunto.
// Pré-requisito: node scripts/fetch-face-models.mjs. Só dev: as fotos ficam fora do repositório e nenhum vetor facial
// é gravado (só estatísticas agregadas). NÃO é validação estatística nem teste de ataque de apresentação
// (ISO/IEC 30107-3): ver docs/26-FACE-BENCHMARK.md.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { cosine, similarityToScore } from '../packages/biometrics/src/face.js';

const rawCosine = (a, b) => {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / Math.sqrt(na * nb);
};

const [dir, labelsPath, outPath] = process.argv.slice(2);
if (!dir || !labelsPath) {
  console.error('uso: node scripts/bench-face.mjs <dir-fotos> <rotulos.json> [saida.json]');
  process.exit(2);
}
const labels = JSON.parse(readFileSync(labelsPath, 'utf8'));
const reader = resolve('apps/reader');
// vite só existe no workspace do leitor
const { ortRawPlugin } = await import(pathToFileURL(join(reader, 'vite.ort.js')).href);
const { createServer } = await import(
  pathToFileURL(join(reader, 'node_modules/vite/dist/node/index.js')).href
);
if (!existsSync(join(reader, 'public/models/sface.onnx'))) {
  console.error('modelos ausentes: rode `node scripts/fetch-face-models.mjs`');
  process.exit(2);
}
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const PAGE = `<!doctype html><meta charset=utf-8><script type=module>
import { createFaceEngine } from '/src/lib/face/engine.js';
import { Human } from '@vladmandic/human';
async function runHumanFaceres(files, opts) {
  const human = new Human({ backend: opts.backend, modelBasePath: '/models/', cacheSensitivity: 0,
    face: { enabled: true, detector: { rotation: true, maxDetected: 2, minConfidence: 0.6 }, mesh: { enabled: true },
      iris: { enabled: false }, description: { enabled: true, modelPath: 'faceres.json' }, emotion: { enabled: false },
      antispoof: { enabled: false }, liveness: { enabled: false } },
    body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false }, segmentation: { enabled: false } });
  const t0 = performance.now();
  await human.load();
  const loadMs = performance.now() - t0;
  const out = [];
  for (const f of files) {
    const img = new Image(); img.src = '/__img/' + f; await img.decode();
    const t = performance.now();
    const r = await human.detect(img);
    const faces = r.face ?? [];
    const one = faces.length === 1 ? faces[0] : null;
    out.push({ file: f, ms: performance.now() - t, ok: !!one?.embedding, code: faces.length > 1 ? 'MULTIPLE_FACES' : 'NO_FACE',
      real: null, live: null, faceW: one?.box?.[2] ?? null, d: one?.embedding ? Array.from(one.embedding) : null });
  }
  return { backend: human.tf.getBackend(), loadMs, out };
}
window.run = async (files, opts) => {
  if (opts.engine === 'human-faceres') return runHumanFaceres(files, opts);
  const t0 = performance.now();
  const engine = await createFaceEngine({ base: '/', backend: opts.backend, bgr: opts.bgr, minFacePx: opts.minFacePx });
  const loadMs = performance.now() - t0;
  const out = [];
  for (const f of files) {
    const img = new Image(); img.src = '/__img/' + f; await img.decode();
    const t = performance.now();
    const r = await engine.analyzeFrame(img);
    out.push({ file: f, ms: performance.now() - t, ok: r.ok, code: r.code ?? null, real: r.real ?? null, live: r.live ?? null,
      faceW: r.faceW ?? null, d: r.descriptor ? Array.from(r.descriptor) : null });
  }
  return { backend: engine.backend, loadMs, out };
};
window.ready = true;
</script>`;

const vite = await createServer({
  root: reader,
  configFile: false,
  appType: 'custom',
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 55199, strictPort: true },
  plugins: [
    ortRawPlugin(),
    {
      name: 'bench-face',
      configureServer(s) {
        s.middlewares.use(async (req, res, next) => {
          const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
          if (url === '/__bench.html') {
            res.setHeader('content-type', 'text/html');
            return res.end(await s.transformIndexHtml('/__bench.html', PAGE)); // resolve imports 'nus'
          }
          if (/^\/models\/faceres\.(json|bin)$/.test(url)) {
            // descritor embutido do Human, só para a comparação (BENCH_ENGINE=human-faceres)
            res.setHeader('content-type', 'application/octet-stream');
            return res.end(
              readFileSync(join(reader, 'node_modules/@vladmandic/human/models', url.slice(8))),
            );
          }
          if (!url.startsWith('/__img/')) return next();
          try {
            const file = join(resolve(dir), url.slice(7).replace(/\.\./g, ''));
            if (!statSync(file).isFile()) throw new Error('x');
            res.setHeader(
              'content-type',
              MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
            );
            res.end(readFileSync(file));
          } catch {
            res.statusCode = 404;
            res.end();
          }
        });
      },
    },
  ],
});
await vite.listen();

const pairList = labels.pairs ?? null;
const files = pairList
  ? [...new Set(pairList.flatMap((p) => [p.a, p.b]))]
  : readdirSync(resolve(dir)).filter((f) => labels[f]);
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
page.setDefaultTimeout(280_000);
page.on('pageerror', (e) => console.error('pageerror:', String(e.message).slice(0, 300)));
page.on(
  'console',
  (m) =>
    m.type() === 'error' &&
    !m.text().includes('onnxruntime') &&
    console.error('console:', m.text().slice(0, 200)),
);
await page.goto('http://127.0.0.1:55199/__bench.html');
await page.waitForFunction('window.ready === true');
const opts = {
  engine: process.env.BENCH_ENGINE ?? 'sface',
  backend: process.env.BENCH_BACKEND ?? 'webgl',
  bgr: process.env.BENCH_BGR === '1',
  minFacePx: Number(process.env.BENCH_MIN_FACE ?? 110),
};
const run = await page.evaluate(([f, o]) => window.run(f, o), [files, opts]);
await browser.close();
await vite.close();

const rows = run.out.filter((r) => r.ok);
const gen = [];
const imp = [];
const cosGen = [];
const pairs = [];
const emb = new Map(rows.map((r) => [r.file, Float32Array.from(r.d)]));
const consider = (a, b, same) => {
  if (!emb.has(a) || !emb.has(b)) return;
  const sface = opts.engine !== 'human-faceres';
  const c = sface ? cosine(emb.get(a), emb.get(b)) : rawCosine(emb.get(a), emb.get(b));
  (same ? gen : imp).push(sface ? similarityToScore(c) : c); // faceres: escala = cosseno puro
  if (same) cosGen.push(c);
  pairs.push({ a, b, same, cos: +c.toFixed(3) });
};
if (pairList) for (const p of pairList) consider(p.a, p.b, p.same);
else
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++)
      consider(rows[i].file, rows[j].file, labels[rows[i].file] === labels[rows[j].file]);
const stat = (a) =>
  a.length
    ? {
        n: a.length,
        min: +Math.min(...a).toFixed(3),
        max: +Math.max(...a).toFixed(3),
        mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3),
      }
    : { n: 0 };
const rate = (a, t, ge) =>
  a.length ? a.filter((s) => (ge ? s >= t : s < t)).length / a.length : null;
const auc =
  gen.length && imp.length
    ? gen.reduce(
        (a, g) => a + imp.filter((i) => g > i).length + 0.5 * imp.filter((i) => g === i).length,
        0,
      ) /
      (gen.length * imp.length)
    : null;
let eer = null;
let best = 2;
for (let t = 0; t <= 1.0001; t += 0.005) {
  const far = rate(imp, t, true);
  const frr = rate(gen, t, false);
  if (Math.abs(far - frr) < best) {
    best = Math.abs(far - frr);
    eer = { t: +t.toFixed(3), far, frr };
  }
}
const lat = run.out.map((r) => r.ms).sort((a, b) => a - b);
const report = {
  engine:
    opts.engine === 'human-faceres'
      ? 'human faceres (descritor embutido)'
      : 'human(detector+liveness)+sface(onnxruntime-web)',
  backend: run.backend,
  bgr: opts.bgr,
  modelLoadMs: Math.round(run.loadMs),
  images: files.length,
  accepted: rows.length,
  rejected: Object.entries(
    run.out.filter((r) => !r.ok).reduce((m, r) => ({ ...m, [r.code]: (m[r.code] ?? 0) + 1 }), {}),
  ),
  latencyMs: {
    median: Math.round(lat[Math.floor(lat.length / 2)]),
    max: Math.round(lat[lat.length - 1]),
  },
  auc,
  eer,
  genuine: stat(gen),
  impostor: stat(imp),
  genuineCosine: stat(cosGen),
  thresholds: [0.8, 0.85, 0.9, 0.95, 0.98].map((t) => ({
    t,
    FAR: rate(imp, t, true),
    FRR: rate(gen, t, false),
  })),
  closestPairs: pairs.sort((x, y) => y.cos - x.cos).slice(0, 12),
  antispoof: run.out
    .filter((r) => r.ok)
    .map((r) => ({
      f: r.file,
      real: r.real == null ? null : +r.real.toFixed(2),
      live: r.live == null ? null : +r.live.toFixed(2),
      faceW: Math.round(r.faceW),
    }))
    .slice(0, 12),
};
console.log(JSON.stringify(report, null, 1));
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 1));
