// Prepara os modelos do facial no leitor (apps/reader/public/models). Roda antes do dev/build do leitor.
//  - Human (detector, malha, antispoof, liveness): vêm do pacote npm @vladmandic/human (MIT).
//  - ONNX Runtime Web: o .wasm vem do pacote npm onnxruntime-web (MIT); glue .mjs e .wasm vão para public/ort (vite.ort.js).
//  - SFace (reconhecimento, Apache-2.0): baixado do OpenCV Zoo com hash SHA-256 fixado; hash diferente = erro.
// Os binários não vão para o git (apps/reader/public/models e /ort estão no .gitignore); o download é guardado em
// .cache/face-models para não repetir. Em ambiente sem rede, copie o arquivo para .cache/face-models/sface.onnx.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const reader = join(root, 'apps/reader');
const human = join(reader, 'node_modules/@vladmandic/human/models');
const outModels = join(reader, 'public/models');
const outOrt = join(reader, 'public/ort');
const ortDist = join(reader, 'node_modules/onnxruntime-web/dist');
const cache = join(root, '.cache/face-models');

const SFACE = {
  file: 'sface.onnx',
  sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
  url: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx',
};
const HUMAN_MODELS = ['blazeface', 'facemesh', 'antispoof', 'liveness'];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
for (const d of [outModels, outOrt, cache]) mkdirSync(d, { recursive: true });

for (const m of HUMAN_MODELS)
  for (const ext of ['json', 'bin'])
    copyFileSync(join(human, `${m}.${ext}`), join(outModels, `${m}.${ext}`));

for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'])
  copyFileSync(join(ortDist, f), join(outOrt, f));

const cached = join(cache, SFACE.file);
if (!existsSync(cached) || sha256(readFileSync(cached)) !== SFACE.sha256) {
  console.log('baixando SFace (38 MB)...');
  const res = await fetch(SFACE.url);
  if (!res.ok) throw new Error(`falha ao baixar o SFace: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== SFACE.sha256)
    throw new Error('SFace com hash diferente do fixado: arquivo recusado');
  writeFileSync(cached, buf);
}
copyFileSync(cached, join(outModels, SFACE.file));
console.log('modelos do facial prontos em apps/reader/public/models');
