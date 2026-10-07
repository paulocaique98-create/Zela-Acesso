// Chaves de comando de dispositivo (D-021). A chave MESTRA vive só como secret da Edge Function (COMMAND_MASTER_KEY);
// cada agente recebe apenas a sua chave derivada (HMAC da mestra com o id do agente), por canal separado do segredo.
//   node scripts/command-key.mjs gen-master            -> imprime uma mestra nova (64 hex); NÃO gravar em repositório
//   COMMAND_MASTER_KEY=... node scripts/command-key.mjs derive <agent-id>  -> imprime a chave do agente
// Rotação da mestra (sem janela de falha; o agente aceita lista de chaves, atual primeiro):
//   1. gen-master -> nova mestra; para cada agente, derive com a NOVA e entregue a chave por canal protegido.
//   2. Configure no agente as duas chaves (nova + antiga) e reinicie; só então troque COMMAND_MASTER_KEY no gateway.
//   3. Após ~1 min (comandos vivem 30 s), remova a chave antiga do agente. Comando assinado pela antiga passa a ser rejeitado.
// Nunca registrar a saída em log; a chave derivada vai para a configuração protegida do agente (EDGE_COMMAND_KEY).
import { randomBytes } from 'node:crypto';
import { deriveCommandKey } from '../supabase/functions/edge-gateway/handler.js';

const [mode, agentId] = process.argv.slice(2);
if (mode === 'gen-master') {
  console.log(randomBytes(32).toString('hex'));
} else if (mode === 'derive') {
  const master = process.env.COMMAND_MASTER_KEY ?? '';
  if (!/^[0-9a-f]{64}$/.test(master)) {
    console.error('COMMAND_MASTER_KEY ausente ou inválida (64 hex)');
    process.exit(1);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId ?? '')) {
    console.error('informe o id (uuid) do agente');
    process.exit(1);
  }
  console.log(await deriveCommandKey(master, agentId));
} else {
  console.error('uso: gen-master | derive <agent-id>');
  process.exit(1);
}
