import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Porta 55173 (faixa do Zela Acesso); strictPort evita cair em porta de outro projeto.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 55173, strictPort: true },
  // Pre-otimiza no start: sem isso o Vite descobre lucide-react tarde e recarrega a pagina no meio do fluxo.
  optimizeDeps: {
    include: ['lucide-react', 'react-router-dom', '@supabase/supabase-js', 'react-dom/client'],
  },
  preview: { host: '127.0.0.1', port: 55173, strictPort: true },
});
