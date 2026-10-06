// Consulta de CNPJ na API aberta da CNPJa (open.cnpja.com, sem chave) para preencher "Nova organizacao".
// Proxy no servidor: o navegador nao chama o terceiro, so platform_owner/platform_support consultam, e so os campos
// cadastrais da empresa sao devolvidos (socios e demais dados pessoais da resposta sao descartados).
// Nunca registrar CNPJ ou corpo da resposta em log. Logica pura (fetch injetado): ver packages/domain/src/lookup-cnpj.test.js.

export const CNPJA_OPEN_URL = 'https://open.cnpja.com/office';
const TIMEOUT_MS = 8000;
const ALLOWED_ROLES = ['platform_owner', 'platform_support'];

const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');

/** Valida os digitos verificadores do CNPJ (mesma regra de apps/web/src/lib/br.js). */
export function isValidCnpj(v) {
  const d = onlyDigits(v);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len) => {
    let sum = 0;
    let pos = len - 7;
    for (let i = 0; i < len; i++) {
      sum += Number(d[i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

function formatPhone(p) {
  const area = onlyDigits(p?.area);
  const num = onlyDigits(p?.number);
  if (!num) return '';
  const local = num.length > 4 ? `${num.slice(0, -4)}-${num.slice(-4)}` : num;
  return area ? `(${area}) ${local}` : local;
}

/**
 * Converte a resposta da CNPJa nos campos do formulario de organizacao (tudo texto, com os limites do formulario).
 * @param {any} data
 */
export function mapOffice(data) {
  const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const a = data?.address ?? {};
  const email = Array.isArray(data?.emails) ? data.emails.find((e) => e?.address) : null;
  const phone = Array.isArray(data?.phones) ? data.phones.find((p) => p?.number) : null;
  const legalName = s(data?.company?.name, 200);
  const state = s(a.state, 10).toUpperCase();
  return {
    legal_name: legalName,
    name: s(data?.alias, 120) || legalName.slice(0, 120),
    contact_email: s(email?.address, 254).toLowerCase(),
    contact_phone: formatPhone(phone).slice(0, 30),
    postal_code: onlyDigits(a.zip).slice(0, 8),
    street: s(a.street, 200),
    street_number: s(a.number, 20),
    address_complement: s(a.details, 100),
    district: s(a.district, 120),
    city: s(a.city, 120),
    state: /^[A-Z]{2}$/.test(state) ? state : '',
    status: s(data?.status?.text, 60),
  };
}

export function corsHeaders(req, allowedOrigins) {
  const origin = req.headers.get('Origin');
  const allow = origin && allowedOrigins.includes(origin) ? origin : null;
  return {
    ...(allow ? { 'Access-Control-Allow-Origin': allow, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

const json = (status, payload, headers) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });

/**
 * @param {Request} req
 * @param {{ makeUserClient: (authHeader: string) => any, allowedOrigins: string[], fetchImpl?: typeof fetch }} deps
 */
export async function handle(req, deps) {
  const cors = corsHeaders(req, deps.allowedOrigins);
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' }, cors);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'Não autorizado.' }, cors);

  const userClient = deps.makeUserClient(authHeader);
  const { data: auth, error: authError } = await userClient.auth.getUser();
  const caller = auth?.user;
  if (authError || !caller) return json(401, { error: 'Não autorizado.' }, cors);

  // platform_admins so devolve a propria linha (RLS).
  const { data: pa, error: paError } = await userClient
    .from('platform_admins')
    .select('role')
    .eq('user_id', caller.id)
    .maybeSingle();
  if (paError || !ALLOWED_ROLES.includes(pa?.role))
    return json(403, { error: 'Permissão negada.' }, cors);

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Corpo inválido.' }, cors);
  }
  const cnpj = onlyDigits(typeof body?.cnpj === 'string' ? body.cnpj : '');
  if (!isValidCnpj(cnpj)) return json(422, { error: 'CNPJ inválido.' }, cors);

  let res;
  try {
    res = await (deps.fetchImpl ?? fetch)(`${CNPJA_OPEN_URL}/${cnpj}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return json(
      502,
      { error: 'Serviço de consulta de CNPJ indisponível. Preencha manualmente.' },
      cors,
    );
  }
  if (res.status === 404) return json(404, { error: 'CNPJ não encontrado.' }, cors);
  if (res.status === 429)
    return json(
      429,
      { error: 'Limite de consultas atingido. Aguarde um minuto e tente de novo.' },
      cors,
    );
  if (!res.ok)
    return json(
      502,
      { error: 'Serviço de consulta de CNPJ indisponível. Preencha manualmente.' },
      cors,
    );

  let data;
  try {
    data = await res.json();
  } catch {
    return json(502, { error: 'Resposta inválida do serviço de consulta de CNPJ.' }, cors);
  }
  return json(200, { company: mapOffice(data) }, cors);
}
