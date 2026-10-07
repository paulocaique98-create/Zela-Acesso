import { beforeEach, describe, expect, it } from 'vitest';
import { applySnapshot } from './snapshot.js';
import { openStore } from './store.js';
import { processAccessAttempt } from './decide.js';
import {
  ANA_CARD,
  ANA_PIN,
  ANA_TOKEN,
  BOB_PIN,
  IDS,
  MONDAY_10H,
  MONDAY_20H,
  VISITOR_TOKEN,
  makeSnapshot,
} from './fixtures.js';
import { createHash } from 'node:crypto';

let store;
let n;
const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const load = (o, at = MONDAY_10H) =>
  applySnapshot(store, { hash: 'h1', snapshot: makeSnapshot(o) }, at);
const attempt = (credential, extra = {}) =>
  processAccessAttempt({
    store,
    accessPointId: IDS.point,
    credential,
    now: MONDAY_10H,
    offline: false,
    newId: ids,
    ...extra,
  });
const anaPin = { type: 'pin', personId: IDS.ana, pin: ANA_PIN };

beforeEach(() => {
  store = openStore();
  n = 0;
  store.setMeta('clock_drift_s', '0');
  store.setMeta('clock_checked_at', MONDAY_10H.toISOString());
  load();
});

describe('decisão local com o cache', () => {
  it('PIN correto dentro da janela libera (ALLOW/POLICY_MATCH) e enfileira o evento', () => {
    const r = attempt(anaPin);
    expect(r.decision.decision).toBe('ALLOW');
    expect(r.decision.reasonCode).toBe('POLICY_MATCH');
    expect(r.open).toBe(true);
    expect(r.queued).toBe(true);
    expect(store.queueDepth()).toBe(1);
  });

  it('cartão e token móvel resolvem pelo hash (cartão normalizado)', () => {
    expect(attempt({ type: 'card', number: ` ${ANA_CARD.toLowerCase()}-` }).decision.decision).toBe(
      'ALLOW',
    );
    expect(attempt({ type: 'mobile_token', token: ANA_TOKEN }).decision.decision).toBe('ALLOW');
    expect(attempt({ type: 'card', number: 'ZZZZ9999' }).decision.reasonCode).toBe(
      'CREDENTIAL_INVALID',
    );
    expect(attempt({ type: 'mobile_token', token: 'outro' }).decision.reasonCode).toBe(
      'CREDENTIAL_INVALID',
    );
  });

  it('fora da janela nega; pessoa sem grupo nega (padrão negar)', () => {
    expect(attempt(anaPin, { now: MONDAY_20H }).decision.reasonCode).toBe('OUTSIDE_SCHEDULE');
    expect(attempt({ type: 'pin', personId: IDS.bob, pin: BOB_PIN }).decision.reasonCode).toBe(
      'ZONE_NOT_ALLOWED',
    );
  });

  it('pessoa bloqueada nega com PERSON_DISABLED', () => {
    load({ bobStatus: 'blocked' });
    expect(attempt({ type: 'pin', personId: IDS.bob, pin: BOB_PIN }).decision.reasonCode).toBe(
      'PERSON_DISABLED',
    );
  });

  it('PIN errado, formato inválido, pessoa inexistente e tipo desconhecido negam sem abrir', () => {
    for (const c of [
      { type: 'pin', personId: IDS.ana, pin: '000000' },
      { type: 'pin', personId: IDS.ana, pin: 'abc' },
      { type: 'pin', personId: '00000000-0000-0000-0000-000000000000', pin: ANA_PIN },
      { type: 'face', data: 'x' },
      null,
    ]) {
      const r = attempt(c);
      expect(r.open).toBe(false);
      expect(r.decision.reasonCode).toBe('CREDENTIAL_INVALID');
    }
  });

  it('bloqueia o PIN após 5 falhas e destrava depois do prazo', () => {
    for (let i = 0; i < 5; i++) attempt({ ...anaPin, pin: '000000' });
    const locked = attempt(anaPin); // PIN certo, mas bloqueado
    expect(locked.open).toBe(false);
    expect(locked.decision.evidence.steps).toContain('pin:locked');
    const later = attempt(anaPin, { now: new Date(MONDAY_10H.getTime() + 6 * 60_000) });
    expect(later.open).toBe(true);
  });

  it('PIN certo zera o contador de falhas', () => {
    for (let i = 0; i < 4; i++) attempt({ ...anaPin, pin: '000000' });
    attempt(anaPin);
    for (let i = 0; i < 4; i++) attempt({ ...anaPin, pin: '000000' });
    expect(attempt(anaPin).open).toBe(true);
  });
});

describe('modo offline e cache defasado', () => {
  it('offline + degraded_allow libera como DEGRADED_ALLOW', () => {
    const r = attempt(anaPin, { offline: true });
    expect(r.decision.decision).toBe('DEGRADED_ALLOW');
    expect(r.open).toBe(true);
  });

  it('offline + degraded_deny nega mesmo com política permitindo', () => {
    load({ offlineBehavior: 'degraded_deny' });
    const r = attempt(anaPin, { offline: true });
    expect(r.decision.decision).toBe('DEGRADED_DENY');
    expect(r.open).toBe(false);
  });

  it('offline com cache defasado vira DEGRADED_DENY mesmo em degraded_allow', () => {
    const r = attempt(anaPin, {
      offline: true,
      now: new Date(MONDAY_10H.getTime() + 8 * 24 * 3_600_000),
    });
    expect(r.decision.decision).not.toBe('DEGRADED_ALLOW');
    expect(r.open).toBe(false);
    expect(r.decision.evidence.steps).toContain('cache:stale');
  });

  it('flag offline ausente é tratada como offline (conservador)', () => {
    const r = processAccessAttempt({
      store,
      accessPointId: IDS.point,
      credential: anaPin,
      now: MONDAY_10H,
      newId: ids,
    });
    expect(r.decision.decision).toBe('DEGRADED_ALLOW');
    expect(r.decision.evidence.offline).toBe(true);
  });
});

describe('falha fechada', () => {
  it('sem cache: DENY/CONTEXT_INVALID e nada enfileirado (sem tenant conhecido)', () => {
    const empty = openStore();
    const r = processAccessAttempt({
      store: empty,
      accessPointId: IDS.point,
      credential: anaPin,
      now: MONDAY_10H,
      newId: ids,
    });
    expect(r.decision.decision).toBe('DENY');
    expect(r.decision.reasonCode).toBe('CONTEXT_INVALID');
    expect(r.queued).toBe(false);
  });

  it('ponto desconhecido nega e o evento não leva o id forjado', () => {
    const r = attempt(anaPin, { accessPointId: 'ponto-forjado' });
    expect(r.decision.reasonCode).toBe('CONTEXT_INVALID');
    const ev = store.dueEvents(MONDAY_10H.toISOString())[0].payload;
    expect(ev.p_access_point).toBeNull();
    expect(ev.p_zone).toBeNull();
  });

  it('cache corrompido no disco nega (não abre)', () => {
    store.db.prepare("update cache set body = '{quebrado' where id = 1").run();
    expect(attempt(anaPin).open).toBe(false);
  });
});

describe('anti-passback local', () => {
  it('hard: segunda entrada seguida é negada; saída libera e destrava a entrada', () => {
    load({ apbMode: 'hard' });
    expect(attempt(anaPin).open).toBe(true);
    const again = attempt(anaPin);
    expect(again.decision.reasonCode).toBe('ANTI_PASSBACK');
    expect(again.open).toBe(false);
    expect(attempt(anaPin, { accessPointId: IDS.exitPoint }).open).toBe(true);
    expect(attempt(anaPin).open).toBe(true);
  });

  it('soft: libera a segunda entrada e registra a violação na evidência', () => {
    load({ apbMode: 'soft' });
    attempt(anaPin);
    const r = attempt(anaPin);
    expect(r.open).toBe(true);
    expect(r.decision.evidence.antiPassback).toBe('VIOLATION_SOFT');
  });

  it('negação não altera a presença', () => {
    load({ apbMode: 'hard' });
    attempt(anaPin, { now: MONDAY_20H }); // fora da janela
    expect(store.getPresence(IDS.zone, IDS.ana)).toBeNull();
  });
});

describe('evento enfileirado', () => {
  it('é completo, idempotente por chave e não carrega segredo', () => {
    attempt(anaPin);
    const [e] = store.dueEvents(MONDAY_10H.toISOString());
    expect(e.payload.p_tenant).toBe(IDS.tenant);
    expect(e.payload.p_site).toBe(IDS.site);
    expect(e.payload.p_source).toBe('EDGE_AGENT');
    expect(e.payload.p_decision).toBe('ALLOW');
    expect(e.payload.p_idempotency_key).toBe(e.idempotencyKey);
    expect(e.payload.p_person).toBe(IDS.ana);
    const raw = JSON.stringify(e.payload);
    expect(raw).not.toContain(ANA_PIN);
    expect(raw).not.toContain(ANA_TOKEN);
    expect(store.enqueue(e.idempotencyKey, e.payload, MONDAY_10H.toISOString())).toBe(false);
    expect(store.queueDepth()).toBe(1);
  });

  it('toda decisão (inclusive negada) gera evento', () => {
    attempt({ ...anaPin, pin: '000000' });
    expect(store.queueDepth()).toBe(1);
  });
});

describe('relógio do host', () => {
  const degradedLoad = () => load({ offlineBehavior: 'degraded_allow' });

  it('relógio confiável + offline + ponto degraded_allow: DEGRADED_ALLOW sem passo de relógio', () => {
    degradedLoad();
    const r = attempt(anaPin, { offline: true });
    expect(r.decision.decision).toBe('DEGRADED_ALLOW');
    expect(r.decision.evidence.steps.some((s) => s.startsWith('clock:'))).toBe(false);
  });

  it('deriva alta + offline: nega (DEGRADED_DENY) e registra clock:untrusted', () => {
    degradedLoad();
    store.setMeta('clock_drift_s', '900');
    const r = attempt(anaPin, { offline: true });
    expect(r.decision.decision).toBe('DEGRADED_DENY');
    expect(r.decision.evidence.steps).toContain('clock:untrusted');
  });

  it('relógio nunca verificado + offline: nega', () => {
    degradedLoad();
    store.db.exec('delete from meta');
    expect(attempt(anaPin, { offline: true }).decision.decision).toBe('DEGRADED_DENY');
  });

  it('deriva moderada só alerta (clock:warn), sem mudar a decisão', () => {
    degradedLoad();
    store.setMeta('clock_drift_s', '120');
    const r = attempt(anaPin, { offline: true });
    expect(r.decision.decision).toBe('DEGRADED_ALLOW');
    expect(r.decision.evidence.steps).toContain('clock:warn');
  });

  it('com a nuvem acessível (offline: false) a deriva só é registrada', () => {
    store.setMeta('clock_drift_s', '900');
    const r = attempt(anaPin);
    expect(r.decision.decision).toBe('ALLOW');
    expect(r.decision.evidence.steps).toContain('clock:untrusted');
  });

  it('enforceClock: false desliga a negação', () => {
    degradedLoad();
    store.setMeta('clock_drift_s', '900');
    const r = attempt(anaPin, { offline: true, config: { enforceClock: false } });
    expect(r.decision.decision).toBe('DEGRADED_ALLOW');
  });
});

describe('visitante (5C)', () => {
  const visitorSnapshot = (visit) => {
    const snap = makeSnapshot();
    snap.people.push({ id: IDS.visitor, status: 'active' });
    snap.credentials.push({
      id: IDS.visitorToken,
      personId: IDS.visitor,
      type: 'mobile_token',
      status: 'active',
      secretHash: createHash('sha256').update(VISITOR_TOKEN).digest('hex'),
      identifierHash: null,
      expiresAt: '2026-10-05T18:00:00Z',
    });
    if (visit) snap.visits = [{ id: IDS.visit, personId: IDS.visitor, ...visit }];
    return snap;
  };
  const apply = (visit) =>
    applySnapshot(store, { hash: 'hv', snapshot: visitorSnapshot(visit) }, MONDAY_10H);
  const token = { type: 'mobile_token', token: VISITOR_TOKEN };
  const window = {
    validFrom: '2026-10-05T12:00:00Z',
    validUntil: '2026-10-05T18:00:00Z',
    zoneIds: [IDS.zone],
  };

  it('visita com check-in, na janela e na zona libera sem grupo nem política', () => {
    apply(window);
    const r = attempt(token);
    expect(r.decision).toMatchObject({ decision: 'ALLOW', reasonCode: 'POLICY_MATCH' });
    expect(r.decision.evidence.steps).toContain('visit:allowed');
    expect(r.open).toBe(true);
  });
  it('zona fora do escopo da visita nega', () => {
    apply({ ...window, zoneIds: [IDS.otherZone] });
    expect(attempt(token).decision).toMatchObject({ reasonCode: 'VISITOR_ZONE_NOT_ALLOWED' });
  });
  it('depois do fim da janela nega, mesmo com o cache defasado', () => {
    apply(window);
    const r = attempt(token, { now: new Date('2026-10-05T18:00:01Z') });
    expect(r.open).toBe(false);
  });
  it('sem visita no cache, o visitante cai na política e nega', () => {
    apply(null);
    const r = attempt(token);
    expect(r.open).toBe(false);
    expect(r.decision.reasonCode).toBe('ZONE_NOT_ALLOWED');
  });
  it('snapshot antigo (sem visits) continua válido', () => {
    expect(() => apply(undefined)).not.toThrow();
  });
});
