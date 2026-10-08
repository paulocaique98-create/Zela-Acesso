// Textos e formatações do leitor (puros, testáveis).
export const MODE_NOTE = {
  register_only: 'Este leitor só registra a entrada ou saída; ele não aciona porta nem catraca.',
  actuate: 'Este leitor registra e, se autorizado, aciona o ponto de acesso.',
};

export const METHOD_LABEL = { pin: 'Senha', qr: 'QR Code', barcode: 'Código de barras' };

/** Resultado do teste de conexão, a partir da resposta de `status` (ou de falha de transporte). */
export function describeStatus(res) {
  if (!res) return { ok: false, text: 'Sem conexão com o Edge neste endereço.' };
  if (res.ok)
    return {
      ok: true,
      text: `Conectado ao Edge. ${res.offline ? 'O Edge está sem conexão com a nuvem (usa as regras do ponto para esta situação).' : 'Edge e nuvem conectados.'}`,
    };
  const byCode = {
    REVOKED: 'Este leitor foi revogado no painel.',
    UNAUTHORIZED: 'O Edge não reconhece este aparelho. Desative e ative de novo.',
    NO_SNAPSHOT: 'O Edge ainda não sincronizou com a nuvem.',
    POINT_UNAVAILABLE: 'O ponto de acesso deste leitor está inativo ou foi removido.',
    RATE_LIMITED: 'Muitas requisições. Aguarde um minuto.',
    CLOCK_SKEW: 'O relógio do aparelho difere muito do Edge.',
  };
  return {
    ok: false,
    text: byCode[res.code] ?? `O Edge recusou a consulta (${res.code ?? res.status}).`,
  };
}

export function formatUptime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** SO e navegador resumidos (sem identificadores únicos). */
export function summarizeAgent(ua = '') {
  const os =
    /Android ([\d.]+)/.exec(ua)?.[0] ??
    (/iPad|iPhone/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '—');
  const browser =
    /Edg\/([\d.]+)/.exec(ua)?.[0]?.replace('Edg', 'Edge') ??
    /Chrome\/([\d]+)/.exec(ua)?.[0] ??
    /Firefox\/([\d]+)/.exec(ua)?.[0] ??
    /Version\/([\d]+).*Safari/.exec(ua)?.[0]?.replace(/ .*/, '') ??
    '—';
  return { os, browser };
}
