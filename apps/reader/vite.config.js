import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { ortRawPlugin } from './vite.ort.js';

// Porta 55174 (faixa do Zela Acesso). Em desenvolvimento, EDGE_PROXY=http://127.0.0.1:8443 encaminha /reader/v1
// (HTTP e WebSocket) para um Edge local; em produção quem serve a página é o próprio Edge (mesma origem).
const proxy = process.env.EDGE_PROXY
  ? { '/reader/v1': { target: process.env.EDGE_PROXY, ws: true, changeOrigin: false } }
  : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss(), ortRawPlugin()],
  server: { host: '127.0.0.1', port: 55174, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 55174, strictPort: true, proxy },
  build: { sourcemap: false },
});
