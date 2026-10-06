// Testa a logica da Edge Function create-tenant-owner com clientes simulados (sem Deno e sem rede).
import { describe, expect, it, vi } from 'vitest';
import { handle, validateBody } from '../../../supabase/functions/create-tenant-owner/handler.js';

const ORIGIN = 'http://127.0.0.1:55173';
const VALID = {
  name: 'Org Teste',
  slug: 'org-teste',
  owner_name: 'Ana Souza',
  owner_email: 'Ana@Example.test',
  password: 'senha-temporaria-1',
  details: { tax_id: '12345678000190', evil: 'x', notes: 5 },
};

function setup({
  role = 'platform_owner',
  user = { id: 'u1' },
  createError = null,
  flagError = null,
  rpc = { data: 't1' },
} = {}) {
  const admin = {
    auth: {
      admin: {
        createUser: vi.fn(async () =>
          createError
            ? { data: null, error: createError }
            : { data: { user: { id: 'new-owner' } }, error: null },
        ),
        deleteUser: vi.fn(async () => ({ error: null })),
      },
    },
    from: vi.fn(() => ({ upsert: vi.fn(async () => ({ error: flagError })) })),
  };
  const userClient = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: user ? null : { message: 'x' } })),
    },
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null, error: null }) }),
      }),
    })),
    rpc: vi.fn(async () => ({ data: rpc.data ?? null, error: rpc.error ?? null })),
  };
  const deps = {
    makeUserClient: vi.fn(() => userClient),
    makeAdminClient: vi.fn(() => admin),
    allowedOrigins: [ORIGIN],
  };
  return { admin, userClient, deps };
}

const call = (
  deps,
  body,
  headers = { Authorization: 'Bearer t', Origin: ORIGIN },
  method = 'POST',
) =>
  handle(
    new Request('http://fn.test/', {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
    deps,
  );

describe('validateBody', () => {
  it('normaliza e filtra os detalhes pela lista branca', () => {
    const r = validateBody(VALID);
    expect(r.value).toMatchObject({
      name: 'Org Teste',
      slug: 'org-teste',
      ownerEmail: 'ana@example.test',
    });
    expect(r.value.details).toEqual({ tax_id: '12345678000190' });
  });

  it.each([
    [{ ...VALID, name: 'A' }, /Nome/],
    [{ ...VALID, slug: 'Slug Ruim' }, /Identificador/],
    [{ ...VALID, owner_email: 'sem-arroba' }, /E-mail/],
    [{ ...VALID, password: 'curta' }, /senha/],
    [{ ...VALID, owner_name: '' }, /responsável/],
    [null, /Nome/],
  ])('rejeita corpo invalido %#', (body, msg) => {
    expect(validateBody(body).error).toMatch(msg);
  });
});

describe('create-tenant-owner', () => {
  it('OPTIONS: CORS so para origem permitida', async () => {
    const { deps } = setup();
    const ok = await call(deps, null, { Origin: ORIGIN }, 'OPTIONS');
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const bad = await call(deps, null, { Origin: 'https://evil.test' }, 'OPTIONS');
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('sem Authorization: 401 e nada e criado', async () => {
    const { deps, admin } = setup();
    const r = await call(deps, VALID, { Origin: ORIGIN });
    expect(r.status).toBe(401);
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('JWT invalido: 401', async () => {
    const { deps, admin } = setup({ user: null });
    expect((await call(deps, VALID)).status).toBe(401);
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it.each([['platform_support'], [null]])('papel %s: 403, sem criar usuario', async (role) => {
    const { deps, admin } = setup({ role });
    const r = await call(deps, VALID);
    expect(r.status).toBe(403);
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('corpo invalido: 422, sem criar usuario', async () => {
    const { deps, admin } = setup();
    const r = await call(deps, { ...VALID, password: '123' });
    expect(r.status).toBe(422);
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('caminho feliz: cria usuario, marca troca de senha, cria organizacao com o JWT do chamador', async () => {
    const { deps, admin, userClient } = setup();
    const r = await call(deps, VALID);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ tenant_id: 't1' });
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ana@example.test',
        email_confirm: true,
        user_metadata: { display_name: 'Ana Souza' },
      }),
    );
    expect(admin.from).toHaveBeenCalledWith('user_security_flags');
    expect(userClient.rpc).toHaveBeenCalledWith(
      'platform_create_tenant',
      expect.objectContaining({
        p_owner_user_id: 'new-owner',
        p_owner_email: null,
        p_details: { tax_id: '12345678000190' },
      }),
    );
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('senha fraca para o Auth: 422 com a regra, sem organizacao', async () => {
    const { deps, userClient } = setup({ createError: { code: 'weak_password', message: 'x' } });
    const r = await call(deps, VALID);
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/minúscula, maiúscula e número/);
    expect(userClient.rpc).not.toHaveBeenCalled();
  });

  it('e-mail ja usado: 409 sem expor detalhe e sem organizacao', async () => {
    const { deps, userClient } = setup({ createError: { message: 'User already registered' } });
    const r = await call(deps, VALID);
    expect(r.status).toBe(409);
    expect(userClient.rpc).not.toHaveBeenCalled();
  });

  it('falha na marca de troca de senha: desfaz o usuario', async () => {
    const { deps, admin, userClient } = setup({ flagError: { message: 'boom' } });
    expect((await call(deps, VALID)).status).toBe(500);
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith('new-owner');
    expect(userClient.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['23505', 409],
    ['23514', 422],
    ['42501', 403],
    ['XX000', 500],
  ])(
    'erro %s da RPC: desfaz o usuario e responde %i sem texto bruto do banco',
    async (code, status) => {
      const { deps, admin } = setup({
        rpc: { error: { code, message: 'detalhe interno do banco' } },
      });
      const r = await call(deps, VALID);
      expect(r.status).toBe(status);
      expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith('new-owner');
      expect(await r.text()).not.toContain('detalhe interno');
    },
  );

  it('a resposta nunca devolve a senha', async () => {
    const { deps } = setup();
    expect(await (await call(deps, VALID)).text()).not.toContain(VALID.password);
  });
});
