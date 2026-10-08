// onnxruntime-web carrega o glue (.mjs) por import() dinâmico a partir de public/ort. Em dev o Vite reescreve esse
// import() (acrescenta `?import`) e recusa arquivo de /public; este plugin serve /ort/* cru, antes do Vite.
// No build são arquivos estáticos comuns. Os arquivos são copiados por scripts/fetch-face-models.mjs.
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const TYPES = { '.mjs': 'text/javascript', '.wasm': 'application/wasm' };

/** @returns {import('vite').Plugin} */
export function ortRawPlugin() {
  return {
    name: 'zela-ort-raw',
    configureServer(server) {
      const dir = join(server.config.root, 'public/ort');
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url ?? '/', 'http://x').pathname;
        if (!path.startsWith('/ort/') || path.includes('..')) return next();
        const file = join(dir, path.slice(5));
        if (!TYPES[extname(file)] || !existsSync(file)) return next();
        res.setHeader('content-type', TYPES[extname(file)]);
        res.end(readFileSync(file));
      });
    },
  };
}
