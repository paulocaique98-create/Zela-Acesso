import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { FACE_DIM, FACE_PROVIDER_KIND, encodeDescriptor } from '@zela/biometrics';
import { createMockHardware } from '@zela/device-drivers';
import { runBiometricErasures } from './biometric.js';
import { createEdgeFaceProvider } from './face-provider.js';
import { createReaderService } from './reader-service.js';
import { createTestReader } from './reader-test-client.js';
import { applySnapshot } from './snapshot.js';
import { openStore } from './store.js';
import { ANA_PIN, BOB_PIN, ENROLL_CODE, IDS, MONDAY_10H, makeSnapshot } from './fixtures.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const BIO_CRED = 'a0000000-0000-0000-0000-0000000000b1';
const PROFILE_ANA = '0a1b2c3d-0000-4000-8000-000000000001';
const REF_ANA = 'face:7e7e7e7e-1111-4222-8333-444455556666'; // a referência NÃO é o código de captura
const CODE_ANA = '0a1b2c3d';

const person = (seed) => {
  let x = seed * 2654435761 + 1;
  return Float32Array.from({ length: FACE_DIM }, () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967296 - 0.5) * 2;
  });
};
const noisy = (v, amount) => {
  const n = person(99);
  return Float32Array.from(v, (c, i) => c + n[i] * amount);
};
const face = (v, lv = 'PASSED') => ({ d: encodeDescriptor(v), lv });

const settings = (o = {}) => ({
  enabled: true,
  legalBasis: 'fraud_prevention_security',
  retentionDays: 365,
  noticeVersion: 'v1',
  dpoContact: 'dpo@exemplo.com',
  ripdVersion: 'r1',
  ripdNextReviewAt: '2027-06-01',
  threshold: 0.9,
  requireLiveness: true,
  ...o,
});
const profile = (o = {}) => ({
  id: PROFILE_ANA,
  personId: IDS.ana,
  credentialId: BIO_CRED,
  provider: FACE_PROVIDER_KIND,
  templateRef: REF_ANA,
  status: 'active',
  retentionUntil: '2027-10-01T00:00:00Z',
  ...o,
});

let store;
let svc;
let provider;
let now;
let n;
const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const queued = () => store.dueEvents('9999-01-01T00:00:00Z').map((d) => d.payload);

function snapshot({ s = settings(), profiles = [profile()], secondFactor } = {}) {
  const snap = makeSnapshot({
    readers: [
      {
        id: IDS.reader,
        accessPointId: IDS.registerPoint,
        status: 'active',
        enrollmentTokenHash: null,
        enrollmentExpiresAt: '2026-10-06T14:00:00Z',
      },
    ],
  });
  snap.credentials.push({
    id: BIO_CRED,
    personId: IDS.ana,
    type: 'biometric',
    status: 'active',
    secretHash: null,
    identifierHash: null,
    expiresAt: null,
  });
  snap.biometric = { settings: s, profiles, pendingErasure: [] };
  if (secondFactor)
    snap.accessPoints.find((p) => p.id === IDS.registerPoint).secondFactor = secondFactor;
  return snap;
}
const load = (o) => applySnapshot(store, { hash: `h${++n}`, snapshot: snapshot(o) }, now);

/** Leitor já ativado no ponto de registro (chave conhecida do Edge). */
async function activated() {
  const t = createTestReader({ nowMs: () => now.getTime() });
  const enrollSnap = snapshot();
  enrollSnap.readers[0] = {
    id: IDS.reader,
    accessPointId: IDS.registerPoint,
    status: 'pending',
    enrollmentTokenHash: sha256(ENROLL_CODE),
    enrollmentExpiresAt: '2026-10-06T14:00:00Z',
  };
  applySnapshot(store, { hash: 'h-enroll', snapshot: enrollSnap }, now);
  const r = await svc.handle(t.enroll(ENROLL_CODE), { source: '10.0.0.5' });
  expect(r.body.code).toBe('OK');
  t.state.readerId = r.body.readerId;
  load();
  return t;
}
const enrollFace = (t, code, v, lv) => svc.handle(t.faceEnroll({ code, ...face(v, lv) }));
const attempt = (t, v, lv) => svc.handle(t.attempt({ method: 'face', ...face(v, lv) }));

beforeEach(() => {
  store = openStore();
  n = 0;
  now = MONDAY_10H;
  store.setMeta('clock_drift_s', '0');
  store.setMeta('clock_checked_at', MONDAY_10H.toISOString());
  provider = createEdgeFaceProvider({ store });
  svc = createReaderService({
    store,
    driver: createMockHardware({
      points: [IDS.point, IDS.registerPoint],
      now: MONDAY_10H,
      env: 'test',
    }),
    biometricProvider: provider,
    clock: () => now,
    isOffline: () => false,
    newId: ids,
  });
});

describe('status', () => {
  it('só oferece o facial com provedor e política completa e vigente', async () => {
    const t = await activated();
    expect((await svc.handle(t.status())).body.face).toBe(true);
    load({ s: settings({ enabled: false }) });
    expect((await svc.handle(t.status())).body.face).toBe(false);
    load({ s: settings({ ripdNextReviewAt: '2026-01-01' }) });
    expect((await svc.handle(t.status())).body.face).toBe(false);
  });
  it('Edge sem provedor facial (EDGE_FACE desligado) não oferece', async () => {
    const off = createReaderService({
      store,
      driver: null,
      clock: () => now,
      isOffline: () => false,
      newId: ids,
    });
    const t = await activated();
    expect((await off.handle(t.status())).body.face).toBe(false);
    const r = await off.handle(t.attempt({ method: 'face', ...face(person(1)) }));
    expect(r.body.outcome).toBe('INVALID_CREDENTIAL');
  });
});

describe('captura do gabarito (face_enroll)', () => {
  it('cadastra pelo código de captura, uma única vez', async () => {
    const t = await activated();
    const r = await enrollFace(t, CODE_ANA, person(1));
    expect(r.body).toMatchObject({ ok: true, code: 'OK' });
    expect(store.hasFaceTemplate(REF_ANA)).toBe(true);
    // não sobrescreve: o perfil deixou de estar pendente
    expect((await enrollFace(t, CODE_ANA, person(2))).body.code).toBe('ENROLL_NOT_FOUND');
  });
  it('código desconhecido ou malformado é recusado', async () => {
    const t = await activated();
    expect((await enrollFace(t, 'ffffffff', person(1))).body.code).toBe('ENROLL_NOT_FOUND');
    expect((await enrollFace(t, 'XYZ', person(1))).status).toBe(400);
    expect(store.faceTemplateCount()).toBe(0);
  });
  it('exige prova de vida quando a política exige', async () => {
    const t = await activated();
    const r = await enrollFace(t, CODE_ANA, person(1), 'FAILED');
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('LIVENESS_FAILED');
    expect(store.hasFaceTemplate(REF_ANA)).toBe(false);
  });
  it('recusa política desligada', async () => {
    load({ s: settings({ enabled: false }) });
    const t = await activated();
    load({ s: settings({ enabled: false }) });
    expect((await enrollFace(t, CODE_ANA, person(1))).body.code).toBe('FACE_UNAVAILABLE');
  });
  it('recusa o mesmo rosto sob outro perfil', async () => {
    const t = await activated();
    await enrollFace(t, CODE_ANA, person(1));
    const refBia = 'face:99999999-1111-4222-8333-444455556666';
    load({
      profiles: [
        profile(),
        profile({
          id: '99999999-0000-4000-8000-000000000002',
          personId: IDS.bia ?? 'x',
          templateRef: refBia,
        }),
      ],
    });
    const r = await enrollFace(t, '99999999', noisy(person(1), 0.2));
    expect(r.body.code).toBe('FACE_ALREADY_ENROLLED');
    expect(store.hasFaceTemplate(refBia)).toBe(false);
  });
  it('mensagem sem assinatura válida não cadastra nada', async () => {
    const t = await activated();
    const stranger = createTestReader({ nowMs: () => now.getTime(), readerId: IDS.reader });
    const r = await svc.handle(stranger.faceEnroll({ code: CODE_ANA, ...face(person(1)) }));
    expect(r.status).toBe(401);
    expect(store.faceTemplateCount()).toBe(0);
    expect(t).toBeTruthy();
  });
});

describe('tentativa facial', () => {
  async function enrolled() {
    const t = await activated();
    await enrollFace(t, CODE_ANA, person(1));
    return t;
  }
  it('reconhece a pessoa cadastrada e registra', async () => {
    const t = await enrolled();
    const r = await attempt(t, noisy(person(1), 0.25));
    expect(r.body).toMatchObject({ ok: true, outcome: 'REGISTERED' });
    const ev = queued().find((e) => e.p_evidence?.reader?.method === 'face');
    expect(ev.p_evidence.reader).toMatchObject({ method: 'face', mode: 'register_only' });
    expect(ev.p_evidence.steps).toContain('biometric:BIOMETRIC_MATCH');
  });
  it('rosto desconhecido é recusado como credencial inválida', async () => {
    const t = await enrolled();
    expect((await attempt(t, person(7))).body.outcome).toBe('INVALID_CREDENTIAL');
  });
  it('prova de vida reprovada recusa, mesmo com o rosto certo', async () => {
    const t = await enrolled();
    expect((await attempt(t, noisy(person(1), 0.25), 'FAILED')).body.outcome).toBe(
      'INVALID_CREDENTIAL',
    );
  });
  it('perfil fora da retenção é recusado', async () => {
    const t = await enrolled();
    load({ profiles: [profile({ retentionUntil: '2026-01-01T00:00:00Z' })] });
    expect((await attempt(t, noisy(person(1), 0.25))).body.outcome).toBe('INVALID_CREDENTIAL');
  });
  it('limiar da organização vale: limiar máximo recusa um rosto só parecido', async () => {
    const t = await enrolled();
    load({ s: settings({ threshold: 1 }) });
    expect((await attempt(t, noisy(person(1), 1.5))).body.outcome).toBe('INVALID_CREDENTIAL');
  });
  it('perfil revogado/ausente no snapshot não reconhece mais (gabarito local sozinho não basta)', async () => {
    const t = await enrolled();
    load({ profiles: [] });
    expect((await attempt(t, noisy(person(1), 0.25))).body.outcome).toBe('INVALID_CREDENTIAL');
  });
  it('mesma ação reenviada devolve o mesmo resultado sem registrar duas vezes', async () => {
    const t = await enrolled();
    const env = t.attempt({
      method: 'face',
      deviceEventId: 'evt-face-0001',
      ...face(noisy(person(1), 0.2)),
    });
    const a = await svc.handle(env);
    const before = queued().length;
    const b = await svc.handle({ ...env, nonce: 'f'.repeat(32), sig: env.sig });
    expect(a.body.outcome).toBe('REGISTERED');
    expect(b.status === 200 || b.status === 401).toBe(true);
    expect(queued().length).toBe(before);
  });
  it('nenhum vetor facial vai para a fila de eventos nem para a evidência', async () => {
    const t = await enrolled();
    const v = noisy(person(1), 0.2);
    await attempt(t, v);
    await attempt(t, person(8));
    const blob = JSON.stringify(queued());
    expect(blob).not.toContain(encodeDescriptor(v).slice(0, 30));
    expect(blob).not.toContain(encodeDescriptor(person(1)).slice(0, 30));
    expect(blob).not.toContain(CODE_ANA);
  });
});

describe('eliminação (LGPD)', () => {
  it('a fila de eliminação apaga o gabarito facial e confirma na nuvem; depois não reconhece mais', async () => {
    const t = await activated();
    await enrollFace(t, CODE_ANA, person(1));
    expect((await attempt(t, noisy(person(1), 0.2))).body.outcome).toBe('REGISTERED');

    const snap = snapshot({ profiles: [] });
    snap.biometric.pendingErasure = [
      {
        profileId: PROFILE_ANA,
        provider: FACE_PROVIDER_KIND,
        templateRef: REF_ANA,
      },
    ];
    applySnapshot(store, { hash: 'h-erase', snapshot: snap }, now);

    const confirmed = [];
    const transport = {
      confirmBiometricErasure: async (id) => {
        confirmed.push(id);
        return { confirmed: true };
      },
    };
    const r = await runBiometricErasures({ store, transport, provider });
    expect(r.confirmed).toEqual([PROFILE_ANA]);
    expect(confirmed).toHaveLength(1);
    expect(store.hasFaceTemplate(REF_ANA)).toBe(false);
    expect((await attempt(t, noisy(person(1), 0.2))).body.outcome).toBe('INVALID_CREDENTIAL');
  });
});

describe('segundo fator por ponto (PIN depois do facial)', () => {
  const pinOf = (t, challengeId, pin = ANA_PIN) =>
    svc.handle(t.attempt({ method: 'pin', challengeId, pin }));
  async function ready() {
    const t = await activated();
    await enrollFace(t, CODE_ANA, person(1));
    load({ secondFactor: 'pin' });
    return t;
  }
  const open = async (t) => (await attempt(t, noisy(person(1), 0.25))).body;
  const steps = () => queued().flatMap((e) => e.p_evidence?.steps ?? []);

  it('facial reconhecido pede confirmação e devolve um desafio de uso único', async () => {
    const t = await ready();
    const b = await open(t);
    expect(b).toMatchObject({ ok: true, outcome: 'CHALLENGE_REQUIRED' });
    expect(b.challengeId).toMatch(/^[0-9a-f]{32}$/);
    expect(steps()).toContain('second_factor:required');
  });
  it('PIN da mesma pessoa confirma e registra', async () => {
    const t = await ready();
    const { challengeId } = await open(t);
    const r = await pinOf(t, challengeId);
    expect(r.body).toMatchObject({ ok: true, outcome: 'REGISTERED' });
    expect(steps()).toContain('second_factor:pin_ok');
    expect(steps()).toContain('challenge:satisfied');
  });
  it('PIN de OUTRA pessoa é recusado (a pessoa vem do desafio, não do aparelho)', async () => {
    const t = await ready();
    const { challengeId } = await open(t);
    const r = await pinOf(t, challengeId, BOB_PIN);
    expect(r.body.outcome).toBe('INVALID_CREDENTIAL');
    expect(steps()).toContain('challenge:failed');
  });
  it('desafio é de uso único: nem o PIN certo vale depois de uma tentativa', async () => {
    const t = await ready();
    const { challengeId } = await open(t);
    await pinOf(t, challengeId, BOB_PIN);
    expect((await pinOf(t, challengeId)).body.outcome).toBe('INVALID_CREDENTIAL');
  });
  it('desafio expira', async () => {
    const t = await ready();
    const { challengeId } = await open(t);
    now = new Date(now.getTime() + 61_000);
    store.setMeta('clock_checked_at', now.toISOString());
    expect((await pinOf(t, challengeId)).body.outcome).toBe('INVALID_CREDENTIAL');
  });
  it('desafio inventado é recusado sem abrir nada', async () => {
    const t = await ready();
    const r = await pinOf(t, 'a'.repeat(32));
    expect(r.body.outcome).toBe('INVALID_CREDENTIAL');
  });
  it('desafio de um leitor não vale para outro', async () => {
    const t = await ready();
    const { challengeId } = await open(t);
    const other = createTestReader({ nowMs: () => now.getTime(), readerId: IDS.reader });
    expect(
      (await svc.handle(other.attempt({ method: 'pin', challengeId, pin: ANA_PIN }))).status,
    ).toBe(401);
  });
  it('sem o 2º fator no ponto, o facial segue liberando direto (comportamento anterior)', async () => {
    const t = await activated();
    await enrollFace(t, CODE_ANA, person(1));
    const b = await open(t);
    expect(b.outcome).toBe('REGISTERED');
    expect(b.challengeId).toBeUndefined();
  });
  it('PIN errado repetido bloqueia o PIN da pessoa (mesmo limite do PIN comum)', async () => {
    const t = await ready();
    for (let i = 0; i < 5; i++) {
      const { challengeId } = await open(t);
      await pinOf(t, challengeId, '111111');
    }
    const { challengeId } = await open(t);
    expect((await pinOf(t, challengeId)).body.outcome).toBe('INVALID_CREDENTIAL');
    expect(steps()).toContain('second_factor:pin:locked');
  });
  it('o PIN nunca aparece na fila de eventos', async () => {
    const t = await ready();
    const { challengeId } = await open(t);
    await pinOf(t, challengeId);
    expect(JSON.stringify(queued())).not.toContain(ANA_PIN);
  });
});
