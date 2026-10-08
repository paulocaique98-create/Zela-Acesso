// Enrollment do agente: `EDGE_GATEWAY_URL=... EDGE_ENROLL_TOKEN=zea_... EDGE_ENV_OUT=./edge.env node apps/edge-agent/src/enroll.js`
// Gera o par Ed25519 do dispositivo (a privada nunca sai da máquina), troca o token de uso único pela credencial do
// agente e grava a configuração num arquivo novo (modo 0600, nunca sobrescreve). Nada secreto vai ao terminal.
// Depois: `node --env-file=./edge.env apps/edge-agent/src/main.js` (acrescente EDGE_COMMAND_PUBKEYS ou EDGE_COMMAND_TOFU=1).
import { writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair } from './keys.js';
import { enrollAgent } from './transport.js';

export async function runEnroll(env, { fetchImpl, write = writeFileSync, host = hostname() } = {}) {
  const need = (k) => {
    const v = env[k]?.trim();
    if (!v) throw new Error(`variável ${k} ausente`);
    return v;
  };
  const baseUrl = need('EDGE_GATEWAY_URL');
  const token = need('EDGE_ENROLL_TOKEN');
  const out = need('EDGE_ENV_OUT');
  if (!/^zea_[0-9a-f]{64}$/.test(token)) throw new Error('EDGE_ENROLL_TOKEN com formato inválido');

  const { publicKey, privateKey } = generateKeyPair();
  const r = await enrollAgent({
    baseUrl,
    token,
    devicePublicKey: publicKey,
    hostname: host,
    version: env.EDGE_VERSION?.trim() || '0.1.0',
    fetchImpl,
  });
  // 'wx': falha se o arquivo existir (não perde identidade já gravada). Se gravar falhar, o token já foi consumido:
  // o operador cria novo agente (aviso na mensagem).
  try {
    write(
      out,
      [
        `EDGE_GATEWAY_URL=${baseUrl}`,
        `EDGE_AGENT_ID=${r.agentId}`,
        `EDGE_AGENT_SECRET=${r.agentSecret}`,
        `EDGE_DEVICE_KEY=${privateKey}`,
        '',
      ].join('\n'),
      { flag: 'wx', mode: 0o600 },
    );
  } catch {
    throw new Error(
      'enrollment feito, mas não foi possível gravar o arquivo: cadastre um novo agente',
    );
  }
  return { agentId: r.agentId, out };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const r = await runEnroll(process.env);
    console.error(`agente ${r.agentId} cadastrado; configuração gravada em ${r.out}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : 'erro');
    process.exit(1);
  }
}
