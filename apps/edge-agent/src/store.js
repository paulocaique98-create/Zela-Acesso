// Armazenamento local do Edge Agent (SQLite embutido do Node, sem dependência nativa externa).
// Guarda: cache do snapshot (linha única, substituída atomicamente), fila persistente de eventos,
// presença local (anti-passback) e contadores de falha de PIN. Nenhum PIN/token em texto puro entra aqui.

import { DatabaseSync } from 'node:sqlite';
import { createSealer } from './seal.js';

const SCHEMA = `
create table if not exists meta (k text primary key, v text not null);
create table if not exists cache (
  id integer primary key check (id = 1),
  hash text not null, fetched_at text not null, body text not null
);
create table if not exists event_queue (
  id integer primary key autoincrement,
  idempotency_key text not null unique,
  payload text not null,
  created_at text not null,
  attempts integer not null default 0,
  next_attempt_at text not null,
  last_error text,
  sent_at text,
  rejected_at text
);
create index if not exists event_queue_due_idx on event_queue (next_attempt_at) where sent_at is null;
create table if not exists presence (
  zone_id text not null, person_id text not null, state text not null, since text not null,
  primary key (zone_id, person_id)
);
create table if not exists pin_failures (
  person_id text primary key, failures integer not null, locked_until text
);
create table if not exists command_nonces (
  id text primary key, expires_at text not null
);
create table if not exists readers (
  reader_id text primary key, public_key text not null, label text, enrolled_at text not null, reported_at text
);
create table if not exists reader_nonces (
  nonce text primary key, expires_at text not null
);
create table if not exists face_templates (
  ref text primary key, descriptor text not null, created_at text not null
);
create table if not exists reader_attempts (
  reader_id text not null, device_event_id text not null, outcome text not null, created_at text not null,
  primary key (reader_id, device_event_id)
);
`;

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 15 * 60_000;

/** Espera exponencial com teto (determinística; o jitter fica por conta do chamador). @param {number} attempts */
export function backoffMs(attempts) {
  const n = Math.max(1, Math.floor(attempts));
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
}

/**
 * @param {string} [path] arquivo SQLite; ':memory:' (padrão) só para testes
 * @param {{ key?: string | Buffer }} [opts] `key`: cifra snapshot e fila em repouso (AES-256-GCM, ver seal.js)
 */
export function openStore(path = ':memory:', { key } = {}) {
  const sealer = createSealer(key);
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('pragma journal_mode = wal; pragma synchronous = full;');
  db.exec(SCHEMA);
  // bancos criados antes da 4C não têm `rejected_at`
  if (
    !db
      .prepare('pragma table_info(event_queue)')
      .all()
      .some((c) => c.name === 'rejected_at')
  )
    db.exec('alter table event_queue add column rejected_at text');
  const q = (sql) => db.prepare(sql);

  /** Transação imediata: tudo ou nada. @template T @param {() => T} fn @returns {T} */
  const tx = (fn) => {
    db.exec('begin immediate');
    try {
      const r = fn();
      db.exec('commit');
      return r;
    } catch (e) {
      db.exec('rollback');
      throw e;
    }
  };

  return {
    db,
    tx,
    close: () => db.close(),

    // ---- meta (vínculo do agente com tenant/site)
    getMeta: (k) => q('select v from meta where k = ?').get(k)?.v ?? null,
    setMeta: (k, v) =>
      void q(
        'insert into meta (k, v) values (?, ?) on conflict(k) do update set v = excluded.v',
      ).run(k, v),

    // ---- cache do snapshot
    saveSnapshot: ({ hash, fetchedAt, body }) =>
      void q(
        `insert into cache (id, hash, fetched_at, body) values (1, ?, ?, ?)
         on conflict(id) do update set hash = excluded.hash, fetched_at = excluded.fetched_at, body = excluded.body`,
      ).run(hash, fetchedAt, sealer.seal('cache.body', body)),
    loadSnapshotRow: () => {
      const row = q('select hash, fetched_at as fetchedAt, body from cache where id = 1').get();
      return row ? { ...row, body: sealer.open('cache.body', row.body) } : null;
    },
    touchSnapshot: (fetchedAt) =>
      void q('update cache set fetched_at = ? where id = 1').run(fetchedAt),
    wipeCache: () => void q('delete from cache').run(),

    // ---- fila persistente (idempotente pela chave)
    /** @returns {boolean} false se a chave já existia (duplicata ignorada) */
    enqueue: (key, payload, nowIso) =>
      Number(
        q(
          'insert or ignore into event_queue (idempotency_key, payload, created_at, next_attempt_at) values (?, ?, ?, ?)',
        ).run(key, sealer.seal('event_queue.payload', JSON.stringify(payload)), nowIso, nowIso)
          .changes,
      ) === 1,
    dueEvents: (nowIso, limit = 50) =>
      q(
        `select id, idempotency_key as idempotencyKey, payload, attempts from event_queue
         where sent_at is null and rejected_at is null and next_attempt_at <= ? order by id limit ?`,
      )
        .all(nowIso, limit)
        .map((r) => ({ ...r, payload: JSON.parse(sealer.open('event_queue.payload', r.payload)) })),
    markSent: (id, nowIso) =>
      void q('update event_queue set sent_at = ?, last_error = null where id = ?').run(nowIso, id),
    /** `jitter` em [0,1): acrescenta até 20% à espera, para os agentes não retentarem juntos. */
    markFailed: (id, now, error, jitter = 0) => {
      const row = q('select attempts from event_queue where id = ?').get(id);
      const attempts = (row?.attempts ?? 0) + 1;
      const wait = backoffMs(attempts);
      const next = new Date(now.getTime() + wait + Math.floor(wait * 0.2 * jitter)).toISOString();
      q(
        'update event_queue set attempts = ?, next_attempt_at = ?, last_error = ? where id = ?',
      ).run(attempts, next, String(error ?? '').slice(0, 200), id);
    },
    /** Rejeição definitiva da nuvem: sai da fila de envio, mas fica guardado (evidência local) e nunca é apagado. */
    markRejected: (id, nowIso, reason) =>
      void q('update event_queue set rejected_at = ?, last_error = ? where id = ?').run(
        nowIso,
        String(reason ?? '').slice(0, 200),
        id,
      ),
    rejectedCount: () =>
      Number(q('select count(*) as n from event_queue where rejected_at is not null').get().n),
    queueDepth: () =>
      Number(
        q(
          'select count(*) as n from event_queue where sent_at is null and rejected_at is null',
        ).get().n,
      ),
    purgeSent: (beforeIso) =>
      Number(
        q('delete from event_queue where sent_at is not null and sent_at < ?').run(beforeIso)
          .changes,
      ),

    // ---- presença local (anti-passback)
    getPresence: (zoneId, personId) =>
      q('select state, since from presence where zone_id = ? and person_id = ?').get(
        zoneId,
        personId,
      ) ?? null,
    /** Não regride: um evento mais antigo que o estado atual é ignorado (replay offline). */
    setPresence: (zoneId, personId, state, sinceIso) =>
      void q(
        `insert into presence (zone_id, person_id, state, since) values (?, ?, ?, ?)
         on conflict(zone_id, person_id) do update set state = excluded.state, since = excluded.since
         where excluded.since >= presence.since`,
      ).run(zoneId, personId, state, sinceIso),

    // ---- bloqueio por tentativas de PIN
    getPinLock: (personId) =>
      q('select failures, locked_until as lockedUntil from pin_failures where person_id = ?').get(
        personId,
      ) ?? null,
    recordPinFailure: (personId, now, { maxFailures, lockMs }) => {
      const cur =
        q('select failures from pin_failures where person_id = ?').get(personId)?.failures ?? 0;
      const failures = cur + 1;
      const lockedUntil =
        failures >= maxFailures ? new Date(now.getTime() + lockMs).toISOString() : null;
      q(
        `insert into pin_failures (person_id, failures, locked_until) values (?, ?, ?)
         on conflict(person_id) do update set failures = excluded.failures, locked_until = excluded.locked_until`,
      ).run(personId, lockedUntil ? 0 : failures, lockedUntil);
    },
    // ---- anti-replay de comandos: o id de um comando só é aceito uma vez até expirar
    /** @returns {boolean} false se o id já foi usado (replay) */
    claimCommand: (id, expiresAtIso) =>
      Number(
        q('insert or ignore into command_nonces (id, expires_at) values (?, ?)').run(
          id,
          expiresAtIso,
        ).changes,
      ) === 1,
    purgeCommands: (beforeIso) =>
      Number(q('delete from command_nonces where expires_at < ?').run(beforeIso).changes),
    // ---- leitores Zela Pass (D-027): chave pública do aparelho, anti-replay e idempotência por leitura
    getReader: (readerId) =>
      q(
        'select reader_id as readerId, public_key as publicKey, label, enrolled_at as enrolledAt, reported_at as reportedAt from readers where reader_id = ?',
      ).get(readerId) ?? null,
    /** @returns {boolean} false se o leitor já estava ativado aqui (a chave nunca é trocada) */
    enrollReader: (readerId, publicKey, label, nowIso) =>
      Number(
        q(
          'insert or ignore into readers (reader_id, public_key, label, enrolled_at) values (?, ?, ?, ?)',
        ).run(readerId, publicKey, label, nowIso).changes,
      ) === 1,
    unreportedReaders: () =>
      q(
        'select reader_id as readerId, public_key as publicKey, label from readers where reported_at is null order by enrolled_at limit 20',
      ).all(),
    markReaderReported: (readerId, nowIso) =>
      void q('update readers set reported_at = ? where reader_id = ?').run(nowIso, readerId),
    /** @returns {boolean} false se o nonce já foi usado (replay) */
    claimReaderNonce: (nonce, expiresAtIso) =>
      Number(
        q('insert or ignore into reader_nonces (nonce, expires_at) values (?, ?)').run(
          nonce,
          expiresAtIso,
        ).changes,
      ) === 1,
    purgeReaderNonces: (beforeIso) =>
      Number(q('delete from reader_nonces where expires_at < ?').run(beforeIso).changes),
    getReaderAttempt: (readerId, deviceEventId) =>
      q('select outcome from reader_attempts where reader_id = ? and device_event_id = ?').get(
        readerId,
        deviceEventId,
      )?.outcome ?? null,
    // ---- gabaritos faciais (dado biométrico sensível: cifrados em repouso com EDGE_STORE_KEY; nunca em log)
    /** Só grava se a referência ainda não tem gabarito (nunca sobrescreve). @returns {boolean} */
    putFaceTemplate: (ref, descriptorB64, nowIso) =>
      Number(
        q(
          'insert or ignore into face_templates (ref, descriptor, created_at) values (?, ?, ?)',
        ).run(ref, sealer.seal('face_templates.descriptor', descriptorB64), nowIso).changes,
      ) === 1,
    getFaceTemplate: (ref) => {
      const row = q('select descriptor from face_templates where ref = ?').get(ref);
      return row ? sealer.open('face_templates.descriptor', row.descriptor) : null;
    },
    hasFaceTemplate: (ref) => !!q('select 1 as x from face_templates where ref = ?').get(ref),
    /** @returns {boolean} true se existia (apagar de novo é inócuo) */
    deleteFaceTemplate: (ref) =>
      Number(q('delete from face_templates where ref = ?').run(ref).changes) > 0,
    faceTemplateCount: () => Number(q('select count(*) as n from face_templates').get().n),
    /** Só as referências (não revela vetor): a identificação 1:N lê cada gabarito por `getFaceTemplate`. */
    faceTemplateRefs: () =>
      q('select ref from face_templates order by ref')
        .all()
        .map((r) => r.ref),
    saveReaderAttempt: (readerId, deviceEventId, outcome, nowIso) =>
      void q(
        'insert or ignore into reader_attempts (reader_id, device_event_id, outcome, created_at) values (?, ?, ?, ?)',
      ).run(readerId, deviceEventId, outcome, nowIso),
    purgeReaderAttempts: (beforeIso) =>
      Number(q('delete from reader_attempts where created_at < ?').run(beforeIso).changes),
    clearPinFailures: (personId) =>
      void q('delete from pin_failures where person_id = ?').run(personId),
  };
}
