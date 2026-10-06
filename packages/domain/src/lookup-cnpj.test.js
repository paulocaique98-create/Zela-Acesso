// Testa a Edge Function lookup-cnpj com cliente e fetch simulados (sem Deno e sem rede).
import { describe, expect, it, vi } from 'vitest';
import { handle, isValidCnpj, mapOffice } from '../../../supabase/functions/lookup-cnpj/handler.js';

const ORIGIN = 'http://127.0.0.1:55173';
const CNPJ = '00000000000191';
const OFFICE = {
  alias: 'Direcao Geral',
  company: {
    name: 'BANCO DO BRASIL SA',
    members: [{ person: { name: 'Fulano', taxId: '***1**' } }],
  },
  status: { text: 'Ativa' },
  address: {
    street: 'Quadra Saun 5',
    number: 'SN',
    district: 'Asa Norte',
    city: 'Brasília',
    state: 'df',
    details: 'Andar T I',
    zip: '70040912',
  },
  phones: [{ area: '61', number: '34939002' }],
  emails: [{ address: 'Secex@BB.com.br' }],
};

function setup({ role = 'platform_owner', user = { id: 'u1' }, fetchImpl } = {}) {
  const userClient = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: user ? null : { message: 'x' } })),
    },
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null, error: null }) }),
      }),
    })),
  };
  const fetchMock =
    fetchImpl ?? vi.fn(async () => new Response(JSON.stringify(OFFICE), { status: 200 }));
  const deps = {
    makeUserClient: vi.fn(() => userClient),
    allowedOrigins: [ORIGIN],
    fetchImpl: fetchMock,
  };
  const call = (body, headers = { Authorization: 'Bearer t', Origin: ORIGIN }) =>
    handle(
      new Request('http://x/lookup-cnpj', {
        method: 'POST',
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      deps,
    );
  return { call, fetchMock };
}

describe('isValidCnpj', () => {
  it('valida digitos verificadores', () => {
    expect(isValidCnpj('00.000.000/0001-91')).toBe(true);
    expect(isValidCnpj('00000000000192')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
  });
});

describe('mapOffice', () => {
  it('mapeia so campos cadastrais e descarta socios', () => {
    const c = mapOffice(OFFICE);
    expect(c).toEqual({
      legal_name: 'BANCO DO BRASIL SA',
      name: 'Direcao Geral',
      contact_email: 'secex@bb.com.br',
      contact_phone: '(61) 3493-9002',
      postal_code: '70040912',
      street: 'Quadra Saun 5',
      street_number: 'SN',
      address_complement: 'Andar T I',
      district: 'Asa Norte',
      city: 'Brasília',
      state: 'DF',
      status: 'Ativa',
    });
    expect(JSON.stringify(c)).not.toContain('Fulano');
  });

  it('sem nome fantasia usa a razao social; resposta vazia nao quebra', () => {
    expect(mapOffice({ company: { name: 'ACME LTDA' } }).name).toBe('ACME LTDA');
    expect(mapOffice(null).legal_name).toBe('');
    expect(mapOffice({ address: { state: 'XYZ' } }).state).toBe('');
  });
});

describe('lookup-cnpj handler', () => {
  it('consulta e devolve os campos mapeados', async () => {
    const { call, fetchMock } = setup();
    const res = await call({ cnpj: '00.000.000/0001-91' });
    expect(res.status).toBe(200);
    expect((await res.json()).company.legal_name).toBe('BANCO DO BRASIL SA');
    expect(fetchMock.mock.calls[0][0]).toBe(`https://open.cnpja.com/office/${CNPJ}`);
  });

  it('platform_support tambem pode consultar', async () => {
    const { call } = setup({ role: 'platform_support' });
    expect((await call({ cnpj: CNPJ })).status).toBe(200);
  });

  it('sem Authorization: 401; usuario invalido: 401; sem papel de plataforma: 403 (sem chamar a API)', async () => {
    expect((await setup().call({ cnpj: CNPJ }, { Origin: ORIGIN })).status).toBe(401);
    expect((await setup({ user: null }).call({ cnpj: CNPJ })).status).toBe(401);
    const { call, fetchMock } = setup({ role: null });
    expect((await call({ cnpj: CNPJ })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CNPJ invalido ou corpo ilegivel nao chama a API', async () => {
    const { call, fetchMock } = setup();
    expect((await call({ cnpj: '123' })).status).toBe(422);
    expect((await call('{nao-json')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('traduz 404, 429, 5xx e falha de rede', async () => {
    const status = (code) =>
      setup({ fetchImpl: vi.fn(async () => new Response('{}', { status: code })) });
    expect((await status(404).call({ cnpj: CNPJ })).status).toBe(404);
    expect((await status(429).call({ cnpj: CNPJ })).status).toBe(429);
    expect((await status(500).call({ cnpj: CNPJ })).status).toBe(502);
    const down = setup({ fetchImpl: vi.fn(async () => Promise.reject(new Error('net'))) });
    expect((await down.call({ cnpj: CNPJ })).status).toBe(502);
  });

  it('CORS so para origem permitida', async () => {
    const { call } = setup();
    const ok = await call({ cnpj: CNPJ });
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const other = await call(
      { cnpj: CNPJ },
      { Authorization: 'Bearer t', Origin: 'http://evil.test' },
    );
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
