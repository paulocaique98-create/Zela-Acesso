// Cria a conta do responsavel (organization_owner) e a organizacao, num passo so. Somente platform_owner.
// service_role fica restrito a esta funcao (server-side) e so cria/remove o usuario; a organizacao e criada pela
// RPC platform_create_tenant com o JWT de quem chamou (a RPC reaplica a checagem de platform_owner).
// Logica pura (clientes injetados) para testar sem Deno: ver packages/domain/src/create-tenant-owner.test.js.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;
const DETAIL_KEYS = [
  'legal_name',
  'tax_id',
  'municipal_registration',
  'contact_email',
  'contact_phone',
  'postal_code',
  'street',
  'street_number',
  'address_complement',
  'district',
  'city',
  'state',
  'notes',
];

/** @param {unknown} body */
export function validateBody(body) {
  const b = body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body) : {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const name = str(b.name);
  const slug = str(b.slug).toLowerCase();
  const ownerName = str(b.owner_name);
  const ownerEmail = str(b.owner_email).toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';
  if (name.length < 2 || name.length > 120) return { error: 'Nome inválido.' };
  if (!SLUG_RE.test(slug)) return { error: 'Identificador inválido.' };
  if (ownerName.length < 1 || ownerName.length > 120)
    return { error: 'Nome do responsável inválido.' };
  if (!EMAIL_RE.test(ownerEmail) || ownerEmail.length > 254)
    return { error: 'E-mail do responsável inválido.' };
  if (password.length < MIN_PASSWORD || password.length > 128) {
    return { error: `A senha deve ter de ${MIN_PASSWORD} a 128 caracteres.` };
  }
  const src =
    b.details && typeof b.details === 'object'
      ? /** @type {Record<string, unknown>} */ (b.details)
      : {};
  const details = Object.fromEntries(
    DETAIL_KEYS.filter((k) => typeof src[k] === 'string').map((k) => [k, src[k]]),
  );
  return { value: { name, slug, ownerName, ownerEmail, password, details } };
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
 * @param {{ makeUserClient: (authHeader: string) => any, makeAdminClient: () => any, allowedOrigins: string[] }} deps
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

  // platform_admins so devolve a propria linha (RLS). Sem papel de owner, nada acontece (nem valida o corpo).
  const { data: pa, error: paError } = await userClient
    .from('platform_admins')
    .select('role')
    .eq('user_id', caller.id)
    .maybeSingle();
  if (paError || pa?.role !== 'platform_owner')
    return json(403, { error: 'Permissão negada.' }, cors);

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Corpo inválido.' }, cors);
  }
  const parsed = validateBody(body);
  if (parsed.error) return json(422, { error: parsed.error }, cors);
  const { name, slug, ownerName, ownerEmail, password, details } = parsed.value;

  const admin = deps.makeAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password,
    email_confirm: true,
    user_metadata: { display_name: ownerName },
  });
  if (createError || !created?.user) {
    const taken = /already|registered|exists/i.test(createError?.message ?? '');
    return taken
      ? json(409, { error: 'Este e-mail já está em uso por outra conta.' }, cors)
      : json(500, { error: 'Não foi possível criar a conta do responsável.' }, cors);
  }
  const ownerId = created.user.id;
  const rollback = () => admin.auth.admin.deleteUser(ownerId);

  // Troca de senha obrigatoria no primeiro acesso (a senha foi escolhida por outra pessoa).
  const { error: flagError } = await admin
    .from('user_security_flags')
    .upsert({ user_id: ownerId, must_change_password: true }, { onConflict: 'user_id' });
  if (flagError) {
    await rollback();
    return json(500, { error: 'Não foi possível preparar a conta do responsável.' }, cors);
  }

  const { data: tenantId, error: rpcError } = await userClient.rpc('platform_create_tenant', {
    p_name: name,
    p_slug: slug,
    p_owner_user_id: ownerId,
    p_owner_email: null,
    p_details: details,
  });
  if (rpcError) {
    await rollback();
    if (rpcError.code === '23505')
      return json(409, { error: 'Já existe uma organização com esse identificador.' }, cors);
    if (rpcError.code === '23514')
      return json(422, { error: 'Dados da organização inválidos.' }, cors);
    if (rpcError.code === '42501') return json(403, { error: 'Permissão negada.' }, cors);
    return json(500, { error: 'Não foi possível criar a organização.' }, cors);
  }
  return json(200, { tenant_id: tenantId }, cors);
}
