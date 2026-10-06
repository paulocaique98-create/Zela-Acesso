import { chromium } from '@playwright/test';

// Aquece o servidor de desenvolvimento (Vite compila sob demanda): sem isso os primeiros testes em paralelo
// esperam a compilacao e estouram o tempo da tela "Carregando".
export default async function globalSetup(config) {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://127.0.0.1:55173';
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' });
  } finally {
    await browser.close();
  }
}
