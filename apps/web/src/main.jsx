import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import { App } from './App.jsx';
import { installGlobalErrorLogging } from './lib/errorLogger';
import './index.css';

installGlobalErrorLogging();
const root = document.getElementById('root');
if (!root) throw new Error('#root nao encontrado');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
