// Chaves de comando de dispositivo. Duas gerações coexistem durante a transição (D-022):
//
// v2 (Ed25519 + kid, RECOMENDADA): a nuvem assina com chave privada (secret COMMAND_SIGNING_JWK da Edge Function);
// o agente guarda só chaves PÚBLICAS por kid. Roubar o agente não permite forjar comando.
//   node scripts/command-key.mjs gen-signing            -> imprime {jwk, kid, publicKey}; grave o jwk SÓ como secret; nunca em repositório
//   node scripts/command-key.mjs pubkeys <jwk-json>     -> imprime "kid:publicKeyHex" (valor de EDGE_COMMAND_PUBKEYS, âncora na instalação)
// Rotação sem cópia manual (declarações assinadas pela chave ATUAL, repassadas pelo gateway e validadas pelo agente):
//   1. gen-signing -> chave nova (N). Com a chave atual (A):  endorse <jwk-A> <publicKey-N>  -> declaração JSON.
//   2. Coloque a declaração em COMMAND_KEY_STATEMENTS (array JSON) e aguarde os agentes buscarem (≤10 min, ver status).
//   3. Troque COMMAND_SIGNING_JWK para N. Depois da janela, revogue A: revoke <jwk-N> <kid-A> e acrescente ao array.
//   Uma chave não revoga a si mesma. Declaração só vale se assinada por chave que o agente já confia.
//
// v1 (HMAC, legado D-021): chave MESTRA (COMMAND_MASTER_KEY) e chave derivada por agente. Mantido para transição.
//   node scripts/command-key.mjs gen-master | COMMAND_MASTER_KEY=... node scripts/command-key.mjs derive <agent-id>
// Nunca registrar a saída em log.
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import { deriveCommandKey } from '../supabase/functions/edge-gateway/handler.js';
import { isKid, isPublicKeyHex, kidOf, statementMessage } from '../apps/edge-agent/src/keys.js';

const [mode, a, b] = process.argv.slice(2);
const die = (msg) => {
  console.error(msg);
  process.exit(1);
};
const pubHexFromJwk = (jwk) => Buffer.from(jwk.x, 'base64url').toString('hex');
const parseJwk = (text) => {
  try {
    const jwk = JSON.parse(text ?? '');
    if (jwk?.kty === 'OKP' && jwk.crv === 'Ed25519' && jwk.d && jwk.x) return jwk;
  } catch {
    /* cai no erro abaixo */
  }
  return die('informe o JWK Ed25519 (com d) entre aspas');
};

if (mode === 'gen-master') {
  console.log(randomBytes(32).toString('hex'));
} else if (mode === 'derive') {
  const master = process.env.COMMAND_MASTER_KEY ?? '';
  if (!/^[0-9a-f]{64}$/.test(master)) die('COMMAND_MASTER_KEY ausente ou inválida (64 hex)');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a ?? ''))
    die('informe o id (uuid) do agente');
  console.log(await deriveCommandKey(master, a));
} else if (mode === 'gen-signing') {
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  const publicKey = pubHexFromJwk(jwk);
  console.log(
    JSON.stringify({
      jwk: JSON.stringify({ kty: jwk.kty, crv: jwk.crv, d: jwk.d, x: jwk.x }),
      kid: kidOf(publicKey),
      publicKey,
    }),
  );
} else if (mode === 'pubkeys') {
  const publicKey = pubHexFromJwk(parseJwk(a));
  console.log(`${kidOf(publicKey)}:${publicKey}`);
} else if (mode === 'endorse' || mode === 'revoke') {
  const jwk = parseJwk(a);
  const signerPub = pubHexFromJwk(jwk);
  const statement =
    mode === 'endorse'
      ? { type: 'endorse', kid: kidOf(b ?? ''), publicKey: b }
      : { type: 'revoke', kid: b };
  if (mode === 'endorse' && !isPublicKeyHex(b))
    die('informe a chave pública (64 hex) da chave nova');
  if (mode === 'revoke' && !isKid(b)) die('informe o kid (16 hex) a revogar');
  statement.signedBy = kidOf(signerPub);
  statement.signature = sign(
    null,
    Buffer.from(statementMessage(statement), 'utf8'),
    createPrivateKey({ key: jwk, format: 'jwk' }),
  ).toString('hex');
  // sanidade: a pública derivada da privada confere com o JWK
  if (
    createPublicKey(createPrivateKey({ key: jwk, format: 'jwk' })).export({ format: 'jwk' }).x !==
    jwk.x
  )
    die('JWK inconsistente');
  console.log(JSON.stringify(statement));
} else {
  die(
    'uso: gen-signing | pubkeys <jwk> | endorse <jwk-atual> <pub-nova> | revoke <jwk-atual> <kid> | gen-master | derive <agent-id>',
  );
}
