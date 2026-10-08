import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockHardware } from '@zela/device-drivers';
import { createReaderService } from './reader-service.js';
import { createTestReader } from './reader-test-client.js';
import { applySnapshot } from './snapshot.js';
import { openStore } from './store.js';
import {
  ANA_CARD,
  ANA_PIN,
  ANA_REF,
  ANA_TOKEN,
  ENROLL_CODE,
  IDS,
  MONDAY_10H,
  MONDAY_20H,
  makeSnapshot,
} from './fixtures.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
let store;
let driver;
let now;
let svc;
let n;
const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const readerMeta = (over = {}) => ({
  id: IDS.reader,
  accessPointId: IDS.registerPoint,
  status: 'pending',
  enrollmentTokenHash: sha256(ENROLL_CODE),
  enrollmentExpiresAt: '2026-10-06T14:00:00Z',
  ...over,
});
const load = (readers) =>
  applySnapshot(store, { hash: `h${++n}`, snapshot: makeSnapshot({ readers }) }, now);
const queued = () => store.dueEvents('9999-01-01T00:00:00Z').map((d) => d.payload);

/** Ativa um leitor no ponto indicado e devolve o cliente de teste já com o readerId. */
async function activated(point = IDS.registerPoint, id = IDS.reader) {
  load([readerMeta({ id, accessPointId: point })]);
  const t = createTestReader({ nowMs: () => now.getTime() });
  const r = await svc.handle(t.enroll(ENROLL_CODE), { source: '10.0.0.5' });
  expect(r.body.code).toBe('OK');
  t.state.readerId = r.body.readerId;
  load([readerMeta({ id, accessPointId: point, status: 'active', enrollmentTokenHash: null })]);
  return t;
}

beforeEach(() => {
  store = openStore();
  n = 0;
  now = MONDAY_10H;
  store.setMeta('clock_drift_s', '0');
  store.setMeta('clock_checked_at', MONDAY_10H.toISOString());
  driver = createMockHardware({
    points: [IDS.point, IDS.registerPoint],
    now: MONDAY_10H,
    env: 'test',
  });
  svc = createReaderService({
    store,
    driver,
    clock: () => now,
    isOffline: () => false,
    newId: ids,
  });
});

describe('ativação', () => {
  it('troca o código por identidade e informa o modo do ponto', async () => {
    load([readerMeta()]);
    const t = createTestReader({ nowMs: () => now.getTime() });
    const r = await svc.handle(t.enroll(ENROLL_CODE, 'Tablet portaria'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      ok: true,
      readerId: IDS.reader,
      accessPointId: IDS.registerPoint,
      mode: 'register_only',
    });
    expect(store.getReader(IDS.reader).publicKey).toBe(t.keys.publicKey);
    expect(store.unreportedReaders()).toHaveLength(1);
  });

  it('código de uso único: segunda ativação (mesmo código, outra chave) é recusada', async () => {
    load([readerMeta()]);
    const a = createTestReader({ nowMs: () => now.getTime() });
    const b = createTestReader({ nowMs: () => now.getTime() });
    expect((await svc.handle(a.enroll(ENROLL_CODE))).body.ok).toBe(true);
    const r = await svc.handle(b.enroll(ENROLL_CODE));
    expect(r.body).toMatchObject({ ok: false, code: 'ENROLL_REJECTED' });
    expect(store.getReader(IDS.reader).publicKey).toBe(a.keys.publicKey);
  });

  it.each([
    ['código errado', () => `zrd_${'cd'.repeat(32)}`, {}],
    ['código expirado', () => ENROLL_CODE, { enrollmentExpiresAt: '2026-10-05T13:59:59Z' }],
    [
      'leitor já ativo/revogado na nuvem',
      () => ENROLL_CODE,
      { status: 'active', enrollmentTokenHash: null },
    ],
  ])('recusa com resposta genérica: %s', async (_n, code, over) => {
    load([readerMeta(over)]);
    const t = createTestReader({ nowMs: () => now.getTime() });
    const r = await svc.handle(t.enroll(code()));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('ENROLL_REJECTED');
    expect(store.getReader(IDS.reader)).toBeNull();
  });

  it('exige prova de posse da chave privada', async () => {
    load([readerMeta()]);
    const owner = createTestReader({ nowMs: () => now.getTime() });
    const thief = createTestReader({ nowMs: () => now.getTime() });
    // envelope assinado por outra chave, anunciando a pública de `owner`
    const env = owner.enroll(ENROLL_CODE, 'x', { privateKey: thief.keys.privateKey });
    expect((await svc.handle(env)).body.code).toBe('ENROLL_REJECTED');
    expect(store.getReader(IDS.reader)).toBeNull();
  });

  it('recusa replay do mesmo envelope', async () => {
    load([readerMeta()]);
    const t = createTestReader({ nowMs: () => now.getTime() });
    const env = t.enroll(ENROLL_CODE);
    expect((await svc.handle(env)).body.ok).toBe(true);
    expect((await svc.handle(env)).body.ok).toBe(false);
  });

  it('limita ativações por origem', async () => {
    load([readerMeta()]);
    const t = createTestReader({ nowMs: () => now.getTime() });
    let last;
    for (let i = 0; i < 11; i++)
      last = await svc.handle(t.enroll(`zrd_${'ee'.repeat(32)}`), { source: '1.2.3.4' });
    expect(last.status).toBe(429);
  });

  it('sem snapshot não ativa', async () => {
    const t = createTestReader({ nowMs: () => now.getTime() });
    expect((await svc.handle(t.enroll(ENROLL_CODE))).status).toBe(503);
  });
});

describe('autenticação das mensagens', () => {
  it('status de leitor ativo informa modo, sentido e conectividade', async () => {
    const t = await activated();
    const r = await svc.handle(t.status());
    expect(r.body).toMatchObject({
      ok: true,
      mode: 'register_only',
      direction: 'entry',
      offline: false,
    });
  });

  it('leitor desconhecido, assinatura inválida e corpo adulterado: tudo UNAUTHORIZED', async () => {
    const t = await activated();
    const stranger = createTestReader({ readerId: IDS.reader2, nowMs: () => now.getTime() });
    expect((await svc.handle(stranger.status())).body.code).toBe('UNAUTHORIZED');
    const forged = createTestReader({ readerId: IDS.reader, nowMs: () => now.getTime() });
    expect((await svc.handle(forged.status())).body.code).toBe('UNAUTHORIZED');
    const env = t.attempt({ method: 'qr', value: ANA_TOKEN });
    env.body = env.body.replace(ANA_TOKEN, 'outro-token-qualquer');
    expect((await svc.handle(env)).body.code).toBe('UNAUTHORIZED');
    expect(queued()).toHaveLength(0);
  });

  it('replay do mesmo envelope é recusado e não registra duas vezes', async () => {
    const t = await activated();
    const env = t.attempt({ method: 'qr', value: ANA_TOKEN });
    expect((await svc.handle(env)).body.outcome).toBe('REGISTERED');
    expect((await svc.handle(env)).body.code).toBe('REPLAY');
    expect(queued()).toHaveLength(1);
  });

  it('relógio do aparelho fora de ±120 s: CLOCK_SKEW com a hora do Edge para corrigir', async () => {
    const t = await activated();
    const r = await svc.handle(t.status({ ts: now.getTime() - 121_000 }));
    expect(r.body).toMatchObject({ ok: false, code: 'CLOCK_SKEW', serverTime: now.getTime() });
    // reenviando com a hora corrigida (hora do Edge) passa
    expect((await svc.handle(t.status({ ts: r.body.serverTime }))).body.ok).toBe(true);
  });

  it('leitor revogado na nuvem (some do snapshot) é recusado só após assinatura válida', async () => {
    const t = await activated();
    load([]);
    const r = await svc.handle(t.attempt({ method: 'qr', value: ANA_TOKEN }));
    expect(r.body.code).toBe('REVOKED');
    expect(queued()).toHaveLength(0);
  });

  it('quem não tem a chave não gasta a cota do leitor legítimo', async () => {
    const t = await activated();
    const attacker = createTestReader({ readerId: IDS.reader, nowMs: () => now.getTime() });
    for (let i = 0; i < 100; i++)
      expect((await svc.handle(attacker.status(), { source: '6.6.6.6' })).body.code).toBe(
        'UNAUTHORIZED',
      );
    expect((await svc.handle(t.status(), { source: '10.0.0.5' })).body.ok).toBe(true);
  });

  it('inundação por origem leva 429 antes de qualquer verificação de assinatura', async () => {
    const t = await activated();
    const attacker = createTestReader({ readerId: IDS.reader, nowMs: () => now.getTime() });
    let last;
    for (let i = 0; i < 301; i++) last = await svc.handle(attacker.status(), { source: '7.7.7.7' });
    expect(last.status).toBe(429);
    expect((await svc.handle(t.status(), { source: '10.0.0.5' })).body.ok).toBe(true);
  });

  it('limita tentativas por leitor', async () => {
    const t = await activated();
    let last;
    for (let i = 0; i < 31; i++) last = await svc.handle(t.status());
    expect(last.status).toBe(429);
  });
});

describe('marcação em ponto register_only', () => {
  it.each([
    ['QR', () => ({ method: 'qr', value: ANA_TOKEN })],
    ['código de barras', () => ({ method: 'barcode', value: ANA_CARD })],
    ['senha com identificador', () => ({ method: 'pin', identifier: ' m-309 ', pin: ANA_PIN })],
  ])('%s: registra sem acionar porta', async (_n, fields) => {
    const t = await activated();
    const sent = fields();
    // espaços do identificador são recusados pela validação do corpo; o leitor normaliza antes de enviar
    if (sent.identifier) sent.identifier = sent.identifier.trim();
    const r = await svc.handle(t.attempt(sent));
    expect(r.body).toMatchObject({
      ok: true,
      outcome: 'REGISTERED',
      label: 'Registrado',
      mode: 'register_only',
    });
    const ev = queued();
    expect(ev).toHaveLength(1); // só a decisão: nenhum physical_outcome, nenhum comando
    expect(ev[0]).toMatchObject({
      p_event_type: 'access_decision',
      p_decision: 'ALLOW',
      p_person: IDS.ana,
    });
    expect(ev[0].p_evidence.reader).toEqual({
      readerId: IDS.reader,
      method: sent.method,
      mode: 'register_only',
    });
  });

  it('nenhum segredo lido vai para a fila de eventos nem para o registro de leituras', async () => {
    const t = await activated();
    await svc.handle(t.attempt({ method: 'pin', identifier: ANA_REF, pin: ANA_PIN }));
    await svc.handle(t.attempt({ method: 'qr', value: ANA_TOKEN }));
    await svc.handle(t.attempt({ method: 'barcode', value: ANA_CARD }));
    const text =
      JSON.stringify(queued()) +
      JSON.stringify(store.db.prepare('select * from reader_attempts').all());
    for (const secret of [ANA_PIN, ANA_TOKEN, ANA_CARD, ANA_CARD.toUpperCase()])
      expect(text).not.toContain(secret);
  });

  it('mesma leitura reenviada (deviceEventId) devolve o mesmo resultado sem duplicar', async () => {
    const t = await activated();
    const fields = { method: 'qr', value: ANA_TOKEN, deviceEventId: 'evt-fixo-0001' };
    const a = await svc.handle(t.attempt(fields));
    const b = await svc.handle(t.attempt(fields)); // novo nonce, mesmo evento do aparelho
    expect(a.body.outcome).toBe('REGISTERED');
    expect(b.body).toMatchObject({ outcome: 'REGISTERED', duplicate: true });
    expect(queued()).toHaveLength(1);
  });

  it('senha errada e identificador inexistente dão a MESMA resposta (sem oráculo)', async () => {
    const t = await activated();
    const wrong = await svc.handle(
      t.attempt({ method: 'pin', identifier: ANA_REF, pin: '111222' }),
    );
    const ghost = await svc.handle(
      t.attempt({ method: 'pin', identifier: 'NAO-EXISTE', pin: '111222' }),
    );
    expect(wrong.body.outcome).toBe(ghost.body.outcome);
    expect(wrong.body.outcome).not.toBe('REGISTERED');
  });

  it('bloqueia a senha após tentativas seguidas erradas', async () => {
    const t = await activated();
    for (let i = 0; i < 5; i++)
      await svc.handle(t.attempt({ method: 'pin', identifier: ANA_REF, pin: '111222' }));
    const r = await svc.handle(t.attempt({ method: 'pin', identifier: ANA_REF, pin: ANA_PIN }));
    expect(r.body.outcome).not.toBe('REGISTERED'); // PIN certo, mas a pessoa está bloqueada
  });

  it('credencial inválida e fora do horário NÃO registram como aceitas', async () => {
    const t = await activated();
    const bad = await svc.handle(t.attempt({ method: 'qr', value: 'token-inexistente-qualquer' }));
    expect(bad.body.outcome).toBe('INVALID_CREDENTIAL');
    now = MONDAY_20H;
    const late = await svc.handle(t.attempt({ method: 'qr', value: ANA_TOKEN }));
    expect(late.body.outcome).toBe('NOT_AUTHORIZED');
    expect(queued().filter((p) => p.p_decision === 'ALLOW')).toHaveLength(0);
  });

  it('corpo inválido é recusado sem tocar no motor', async () => {
    const t = await activated();
    const r = await svc.handle(t.attempt({ method: 'qr', value: 'x' }));
    expect(r.status).toBe(400);
    expect(queued()).toHaveLength(0);
  });

  it('offline: o comportamento do ponto manda (degraded_allow registra como aceita)', async () => {
    const off = createReaderService({
      store,
      driver,
      clock: () => now,
      isOffline: () => true,
      newId: ids,
    });
    const t = await activated();
    const r = await off.handle(t.attempt({ method: 'qr', value: ANA_TOKEN }));
    expect(r.body.outcome).toBe('REGISTERED');
    expect(queued()[0].p_decision).toBe('DEGRADED_ALLOW');
  });
});

describe('ponto com atuação', () => {
  it('leitor num ponto com driver abre pelo caminho normal e reporta o resultado físico', async () => {
    const t = await activated(IDS.point);
    const r = await svc.handle(t.attempt({ method: 'qr', value: ANA_TOKEN }));
    expect(r.body).toMatchObject({ outcome: 'REGISTERED', mode: 'actuate' });
    expect(queued().map((p) => p.p_event_type)).toEqual(['access_decision', 'physical_outcome']);
    expect(queued()[0].p_evidence.reader.mode).toBe('actuate');
  });

  it('negado no ponto com driver nunca aciona a porta', async () => {
    const t = await activated(IDS.point);
    const r = await svc.handle(t.attempt({ method: 'qr', value: 'token-inexistente-qualquer' }));
    expect(r.body.outcome).toBe('INVALID_CREDENTIAL');
    expect(queued().map((p) => p.p_event_type)).toEqual(['access_decision']);
  });

  it('sem driver instalado, ponto com atuação só registra (nunca "abre")', async () => {
    const noDrv = createReaderService({
      store,
      driver: null,
      clock: () => now,
      isOffline: () => false,
      newId: ids,
    });
    load([readerMeta({ accessPointId: IDS.point })]);
    const t = createTestReader({ nowMs: () => now.getTime() });
    const e = await noDrv.handle(t.enroll(ENROLL_CODE));
    expect(e.body.mode).toBe('register_only');
  });
});
