// Registro de erros do navegador em public.error_logs (via RPC log_error). Regras (CLAUDE.md): nunca PIN,
// token, segredo ou biometria no log. O servidor tambem remove chaves sensiveis; aqui se limita o que sai.
import { sanitizeContext } from './sanitize';
import { supabase } from './supabase';

const MAX_PER_MINUTE = 10;
let sent = [];

/**
 * @param {{ category: string, message: string, stack?: string, severity?: 'warn' | 'error' | 'critical',
 *   context?: Record<string, unknown>, tenantId?: string | null, screen?: string }} entry
 */
export async function logClientError(entry) {
  const now = Date.now();
  sent = sent.filter((t) => now - t < 60_000);
  if (sent.length >= MAX_PER_MINUTE) return;
  sent.push(now);
  try {
    await supabase.rpc('log_error', {
      p_source: 'client',
      p_category: entry.category,
      p_message: entry.message,
      p_severity: entry.severity ?? 'error',
      p_stack: entry.stack ?? null,
      p_context: entry.context ? sanitizeContext(entry.context) : null,
      p_tenant_id: entry.tenantId ?? null,
      p_screen: entry.screen ?? window.location.pathname,
      p_url: window.location.href,
      p_user_agent: navigator.userAgent,
    });
  } catch {
    // melhor esforco: o log nunca pode quebrar a tela
  }
}

let installed = false;
/** Captura erros nao tratados e promises rejeitadas. Sem sessao a RPC recusa (silenciosamente). */
export function installGlobalErrorLogging() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => {
    void logClientError({
      category: 'window.error',
      message: e.message || 'Erro não tratado',
      stack: e.error?.stack,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    void logClientError({
      category: 'unhandledrejection',
      message: reason?.message ?? String(reason ?? 'Promise rejeitada'),
      stack: reason?.stack,
    });
  });
}
