import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root nao encontrado');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
