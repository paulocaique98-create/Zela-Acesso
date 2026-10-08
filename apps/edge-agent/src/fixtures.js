// Fixtures de teste do Edge Agent (dados sintéticos). Não importar em código de produção.

import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export const IDS = {
  tenant: '10000000-0000-0000-0000-00000000000a',
  site: '20000000-0000-0000-0000-00000000000a',
  zone: '30000000-0000-0000-0000-00000000000a',
  point: '40000000-0000-0000-0000-00000000000a',
  exitPoint: '40000000-0000-0000-0000-0000000000a2',
  group: '50000000-0000-0000-0000-00000000000a',
  schedule: '70000000-0000-0000-0000-00000000000a',
  policy: '80000000-0000-0000-0000-00000000000a',
  ana: '90000000-0000-0000-0000-0000000000a1',
  bob: '90000000-0000-0000-0000-0000000000a2',
  anaPin: 'a0000000-0000-0000-0000-0000000000a1',
  anaCard: 'a0000000-0000-0000-0000-0000000000a2',
  bobPin: 'a0000000-0000-0000-0000-0000000000a3',
  anaToken: 'a0000000-0000-0000-0000-0000000000a4',
  visitor: '90000000-0000-0000-0000-0000000000a9',
  visitorToken: 'a0000000-0000-0000-0000-0000000000a9',
  visit: 'b0000000-0000-0000-0000-0000000000a9',
  otherZone: '30000000-0000-0000-0000-0000000000a2',
  registerPoint: '40000000-0000-0000-0000-0000000000a3',
  reader: 'c0000000-0000-0000-0000-0000000000a1',
  reader2: 'c0000000-0000-0000-0000-0000000000a2',
};

export const ANA_REF = 'M-309';
export const ENROLL_CODE = `zrd_${'ab'.repeat(32)}`;
export const ANA_PIN = '482913';
export const ANA_CARD = 'ab12cd34';
export const ANA_TOKEN = 'token-sintetico-de-alta-entropia';
export const BOB_PIN = '739104';
export const VISITOR_TOKEN = 'token-do-visitante-de-alta-entropia';

/** Segunda-feira 10:00 em America/Manaus (UTC-4), dentro da janela 08–18. */
export const MONDAY_10H = new Date('2026-10-05T14:00:00Z');
/** Segunda-feira 20:00 em Manaus: fora da janela. */
export const MONDAY_20H = new Date('2026-10-06T00:00:00Z');

/** @param {{ offlineBehavior?: string, apbMode?: string, bobStatus?: string, readers?: object[] }} [o] */
export function makeSnapshot(o = {}) {
  return {
    version: 1,
    tenantId: IDS.tenant,
    siteId: IDS.site,
    timezone: 'America/Manaus',
    zones: [{ id: IDS.zone, antipassbackMode: o.apbMode ?? 'off', antipassbackResetMinutes: 60 }],
    accessPoints: [
      {
        id: IDS.point,
        zoneId: IDS.zone,
        status: 'active',
        direction: 'entry',
        emergencyBehavior: 'fail_safe',
        offlineBehavior: o.offlineBehavior ?? 'degraded_allow',
      },
      {
        id: IDS.exitPoint,
        zoneId: IDS.zone,
        status: 'active',
        direction: 'exit',
        emergencyBehavior: 'fail_safe',
        offlineBehavior: 'degraded_allow',
      },
      {
        id: IDS.registerPoint,
        zoneId: IDS.zone,
        status: 'active',
        direction: 'entry',
        emergencyBehavior: 'fail_safe',
        offlineBehavior: 'degraded_allow',
        actuation: 'none',
      },
    ],
    readers: o.readers ?? [],
    policies: [
      {
        id: IDS.policy,
        groupId: IDS.group,
        zoneId: IDS.zone,
        accessPointId: null,
        effect: 'allow',
        scheduleId: IDS.schedule,
        requireChallenge: false,
        status: 'active',
      },
    ],
    schedules: [
      {
        id: IDS.schedule,
        validFrom: null,
        validUntil: null,
        holidayBehavior: 'deny',
        windows: [{ weekday: 1, start: '08:00:00', end: '18:00:00' }],
        holidayDates: [],
      },
    ],
    groupMembers: [{ groupId: IDS.group, personId: IDS.ana }],
    people: [
      { id: IDS.ana, status: 'active', refHash: sha256(`${IDS.tenant}:${ANA_REF}`) },
      { id: IDS.bob, status: o.bobStatus ?? 'active' },
    ],
    credentials: [
      {
        id: IDS.anaPin,
        personId: IDS.ana,
        type: 'pin',
        status: 'active',
        secretHash: bcrypt.hashSync(ANA_PIN, 4),
        identifierHash: null,
        expiresAt: null,
      },
      {
        id: IDS.anaCard,
        personId: IDS.ana,
        type: 'card',
        status: 'active',
        secretHash: null,
        identifierHash: sha256(`${IDS.tenant}:${ANA_CARD.toUpperCase()}`),
        expiresAt: null,
      },
      {
        id: IDS.anaToken,
        personId: IDS.ana,
        type: 'mobile_token',
        status: 'active',
        secretHash: sha256(ANA_TOKEN),
        identifierHash: null,
        expiresAt: '2027-01-01T00:00:00Z',
      },
      {
        id: IDS.bobPin,
        personId: IDS.bob,
        type: 'pin',
        status: 'active',
        secretHash: bcrypt.hashSync(BOB_PIN, 4),
        identifierHash: null,
        expiresAt: null,
      },
    ],
  };
}
