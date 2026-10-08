// Driver Control iD (Access API REST/JSON) atrás do contrato HAL.
// Fonte: https://www.controlid.com.br/docs/access-api-en e exemplos oficiais em github.com/controlid/integracao.
// NÃO TESTADO contra equipamento: o teste usa um fetch simulado. Ver docs/08-HARDWARE-INTEGRATION.md §5.1 e D-023.
// O driver não decide acesso: o Edge já autenticou/autorizou. Opera o terminal em modo Standalone
// (o terminal identifica e autoriza; o Monitor só informa eventos).

import { isValidUnlockMs } from './contract.js';

const DEFAULT_UNLOCK_MS = 5_000;
const MODELS = new Set(['door', 'sec_box', 'catra']);
const CATRA_ALLOW = new Set(['clockwise', 'anticlockwise', 'both']);
const MAX_CHANGES = 1000;
// Códigos de `event` do access_logs / resultado de identificação (enum oficial em iDAccess.cs dos exemplos).
const EVT_NOT_IDENTIFIED = 3;
const EVT_TIMEOUT = 5;
const EVT_DENIED = 6;
const EVT_GRANTED = 7;

/**
 * @typedef {object} ControlIdPoint
 * @property {string} baseUrl ex.: 'http://192.168.0.129' (rede local; nunca expor à internet)
 * @property {string} login
 * @property {string} password
 * @property {'door'|'sec_box'|'catra'} model define a ação de abertura (door: iDAccess/iDFit; sec_box: iDFlex/iDAccess Pro/Nano; catra: iDBlock)
 * @property {number} [doorNumber] model=door, relé 1..4 (padrão 1)
 * @property {string|number} [secBoxId] model=sec_box, obrigatório
 * @property {number} [reason] model=sec_box (padrão 3)
 * @property {'clockwise'|'anticlockwise'|'both'} [allow] model=catra (padrão 'both')
 * @property {number|string} [deviceId] id do dispositivo, para associar notificações do Monitor e do Push
 * @property {'direct'|'push'} [transport] 'direct' (padrão): o Edge chama o terminal. 'push': o terminal busca os comandos
 *   no Edge (modo Push); mais lento (até um período de consulta) e com autenticação mais fraca, ver handlePush.
 */

const bad = (m) => {
  throw new Error(`controlid: ${m}`);
};

function validatePoint(id, p) {
  if (!p || typeof p !== 'object') bad(`ponto ${id} inválido`);
  let u;
  try {
    u = new URL(p.baseUrl);
  } catch {
    bad(`ponto ${id}: baseUrl inválida`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    bad(`ponto ${id}: baseUrl deve ser http(s)`);
  if (!p.login || !p.password) bad(`ponto ${id}: login e senha são obrigatórios`);
  if (!MODELS.has(p.model)) bad(`ponto ${id}: model deve ser door, sec_box ou catra`);
  if (p.model === 'sec_box' && (p.secBoxId == null || !/^\d+$/.test(String(p.secBoxId))))
    bad(`ponto ${id}: secBoxId numérico é obrigatório para sec_box`);
  if (
    p.model === 'door' &&
    p.doorNumber != null &&
    !(Number.isInteger(p.doorNumber) && p.doorNumber >= 1 && p.doorNumber <= 4)
  )
    bad(`ponto ${id}: doorNumber deve ser 1..4`);
  if (p.model === 'catra' && p.allow != null && !CATRA_ALLOW.has(p.allow))
    bad(`ponto ${id}: allow inválido`);
  if (p.transport != null && p.transport !== 'direct' && p.transport !== 'push')
    bad(`ponto ${id}: transport inválido`);
  if (p.transport === 'push' && p.deviceId == null)
    bad(`ponto ${id}: transport push exige deviceId`);
  return { ...p, baseUrl: u.origin };
}

/** Parâmetros da ação de abertura, por modelo. */
function unlockAction(p) {
  if (p.model === 'door') return { action: 'door', parameters: `door=${p.doorNumber ?? 1}` };
  if (p.model === 'sec_box')
    return { action: 'sec_box', parameters: `id=${p.secBoxId}, reason=${p.reason ?? 3}` };
  return { action: 'catra', parameters: `allow=${p.allow ?? 'both'}` };
}

/**
 * @param {{ points: Record<string, ControlIdPoint>, fetchImpl?: typeof fetch, timeoutMs?: number,
 *   env?: string, now?: () => Date, holdOpenMs?: number, aliveIntervalMs?: number, monitorPathPrefix?: string }} cfg
 * @returns {import('./contract.js').HardwareDriver & Record<string, any>}
 */
export function createControlIdDriver({
  points,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
  env,
  now = () => new Date(),
  holdOpenMs = 30_000,
  aliveIntervalMs = 30_000,
  monitorPathPrefix = '/api/notifications',
  pushWaitMs = 15_000,
}) {
  const production = (env ?? process.env.NODE_ENV) === 'production';
  /** @type {Map<string, any>} */
  const pts = new Map();
  for (const [id, raw] of Object.entries(points ?? {})) {
    const p = validatePoint(id, raw);
    if (production && p.login === 'admin' && p.password === 'admin')
      bad(`ponto ${id}: credencial de fábrica (admin/admin) proibida em produção`);
    pts.set(id, {
      cfg: p,
      session: null,
      online: true,
      door: 'closed',
      locked: true,
      unlockedUntil: 0,
      openedAt: 0,
      heldFlagged: false,
      lastSeen: 0,
      aliveSeen: false,
      pending: null,
    });
  }
  const handlers = new Set();
  const prefix = monitorPathPrefix.replace(/\/+$/, '');

  const emit = (type, pointId, data) => {
    const e = { type, pointId, at: now().toISOString(), ...(data ? { data } : {}) };
    for (const h of handlers) h(e);
  };
  const setOnline = (pointId, p, online) => {
    if (p.online === online) return;
    p.online = online;
    emit(online ? 'device.online' : 'device.offline', pointId);
  };

  /** Chamada HTTP ao terminal; devolve { status, json } ou { err: 'TIMEOUT'|'OFFLINE' }. Nunca registra senha/sessão. */
  async function http(p, path, body, session) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const url = `${p.cfg.baseUrl}/${path}.fcgi${session ? `?session=${encodeURIComponent(session)}` : ''}`;
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: ctl.signal,
      });
      let json = null;
      try {
        json = await res.json();
      } catch {
        /* corpo vazio ou não JSON */
      }
      return { status: res.status, json };
    } catch (e) {
      return { err: e?.name === 'AbortError' ? 'TIMEOUT' : 'OFFLINE' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Executa um comando com sessão; refaz o login uma vez se a sessão expirou (401/403: HIPÓTESE de como o terminal sinaliza). */
  async function call(pointId, p, path, body) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!p.session) {
        const r = await http(p, 'login', { login: p.cfg.login, password: p.cfg.password }, null);
        if (r.err) return r;
        if (r.status !== 200 || typeof r.json?.session !== 'string' || !r.json.session)
          return { err: 'AUTH' };
        p.session = r.json.session;
      }
      const r = await http(p, path, body, p.session);
      if (r.err) return r;
      if (r.status === 401 || r.status === 403) {
        p.session = null;
        continue;
      }
      setOnline(pointId, p, true);
      return r;
    }
    return { err: 'AUTH' };
  }

  const fail = (pointId, p, err) => {
    if (err === 'TIMEOUT' || err === 'OFFLINE') setOnline(pointId, p, false);
    // AUTH (credencial recusada) não prova que o terminal está offline; vira falha de comando.
    return { ok: false, code: err === 'TIMEOUT' ? 'TIMEOUT' : 'DEVICE_OFFLINE' };
  };

  const byDeviceId = (deviceId) => {
    if (deviceId == null) return null;
    for (const [id, p] of pts)
      if (p.cfg.deviceId != null && String(p.cfg.deviceId) === String(deviceId)) return [id, p];
    return null;
  };
  const bySecBox = (sid) => {
    for (const [id, p] of pts)
      if (p.cfg.model === 'sec_box' && String(p.cfg.secBoxId) === String(sid)) return [id, p];
    return null;
  };

  function applyDoorState(pointId, p, open) {
    const t = now().getTime();
    if (open && p.door === 'closed') {
      p.door = 'open';
      p.openedAt = t;
      p.heldFlagged = false;
      emit('door.opened', pointId);
    } else if (!open && p.door !== 'closed') {
      p.door = 'closed';
      emit('door.closed', pointId);
    }
  }

  /** Enfileira um comando para o terminal buscar no próximo /push e espera o /result. Um comando por ponto. */
  function pushCommand(pointId, p, command) {
    if (p.pending) return Promise.resolve({ ok: false, code: 'TIMEOUT' });
    return new Promise((resolve) => {
      const entry = { command, uuid: null, resolve };
      entry.timer = setTimeout(() => {
        if (p.pending === entry) p.pending = null;
        setOnline(pointId, p, false);
        resolve({ ok: false, code: 'TIMEOUT' });
      }, pushWaitMs);
      p.pending = entry;
    });
  }

  const finishPending = (p, result) => {
    const e = p.pending;
    if (!e) return;
    clearTimeout(e.timer);
    p.pending = null;
    e.resolve(result);
  };

  return {
    kind: 'controlid',

    async unlock(pointId, opts = {}) {
      const p = pts.get(pointId);
      if (!p) return { ok: false, code: 'UNKNOWN_POINT' };
      const durationMs = opts.durationMs ?? DEFAULT_UNLOCK_MS;
      if (!isValidUnlockMs(durationMs)) return { ok: false, code: 'INVALID_ARGUMENT' };
      // O tempo aberto é o do relé configurado no terminal (setRelayTimeout); o driver só espelha o estado.
      if (p.cfg.transport === 'push') {
        const res = await pushCommand(pointId, p, {
          verb: 'POST',
          endpoint: 'execute_actions',
          body: { actions: [unlockAction(p.cfg)] },
          contentType: 'application/json',
        });
        if (!res.ok) return res;
        p.locked = false;
        p.unlockedUntil = now().getTime() + durationMs;
        return { ok: true, code: 'OK' };
      }
      const r = await call(pointId, p, 'execute_actions', { actions: [unlockAction(p.cfg)] });
      if (r.err) return fail(pointId, p, r.err);
      if (r.status !== 200) return { ok: false, code: 'DEVICE_OFFLINE' };
      const st = r.json?.actions?.[0]?.status;
      if (st === 'denied') return { ok: false, code: 'INTERLOCK_DENIED' };
      p.locked = false;
      p.unlockedUntil = now().getTime() + durationMs;
      return { ok: true, code: 'OK' };
    },

    // O terminal não tem comando de "travar": o relé religa sozinho pelo tempo configurado e a saída livre é do hardware.
    // Reafirma o estado local travado (mesma semântica do `lock` remoto, 08 §4).
    async lock(pointId) {
      const p = pts.get(pointId);
      if (!p) return { ok: false, code: 'UNKNOWN_POINT' };
      if (!p.online) return { ok: false, code: 'DEVICE_OFFLINE' };
      p.locked = true;
      p.unlockedUntil = 0;
      return { ok: true, code: 'OK' };
    },

    getStatus(pointId) {
      const p = pts.get(pointId);
      return p ? { online: p.online, door: p.door, locked: p.locked } : null;
    },

    onEvent(handler) {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },

    tick(next) {
      const t = next.getTime();
      for (const [id, p] of pts) {
        if (!p.locked && p.unlockedUntil && t >= p.unlockedUntil) {
          p.locked = true;
          p.unlockedUntil = 0;
        }
        if (p.door === 'open' && !p.heldFlagged && t - p.openedAt >= holdOpenMs) {
          p.door = 'held_open';
          p.heldFlagged = true;
          emit('door.held_open', id);
        }
        if (p.aliveSeen && p.online && t - p.lastSeen > aliveIntervalMs * 3)
          setOnline(id, p, false);
      }
    },

    // ---- operação (não fazem parte do contrato HAL)

    /** Define o tempo do relé (ms) no terminal; só model=door (relayN_timeout: exemplo oficial de set_configuration). */
    async setRelayTimeout(pointId, ms) {
      const p = pts.get(pointId);
      if (!p) return { ok: false, code: 'UNKNOWN_POINT' };
      if (p.cfg.model !== 'door' || !isValidUnlockMs(ms))
        return { ok: false, code: 'INVALID_ARGUMENT' };
      const r = await call(pointId, p, 'set_configuration', {
        general: { [`relay${p.cfg.doorNumber ?? 1}_timeout`]: String(ms) },
      });
      if (r.err) return fail(pointId, p, r.err);
      return r.status === 200 ? { ok: true, code: 'OK' } : { ok: false, code: 'DEVICE_OFFLINE' };
    },

    /** Configura o Monitor para o Edge. O caminho leva um segredo aleatório (o terminal não assina as notificações). */
    async configureMonitor(pointId, { hostname, port }) {
      const p = pts.get(pointId);
      if (!p) return { ok: false, code: 'UNKNOWN_POINT' };
      if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535)
        return { ok: false, code: 'INVALID_ARGUMENT' };
      const r = await call(pointId, p, 'set_configuration', {
        monitor: {
          request_timeout: '5000',
          hostname: String(hostname),
          port: String(port),
          path: prefix.replace(/^\//, ''),
          alive_interval: String(aliveIntervalMs),
        },
      });
      if (r.err) return fail(pointId, p, r.err);
      return r.status === 200 ? { ok: true, code: 'OK' } : { ok: false, code: 'DEVICE_OFFLINE' };
    },

    /** Configura o modo Push no terminal (push_server; o exemplo oficial usa timeout 4000 ms e período 5 s). */
    async configurePush(pointId, { hostname, port }) {
      const p = pts.get(pointId);
      if (!p) return { ok: false, code: 'UNKNOWN_POINT' };
      if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535)
        return { ok: false, code: 'INVALID_ARGUMENT' };
      const r = await call(pointId, p, 'set_configuration', {
        push_server: {
          push_request_timeout: '4000',
          push_request_period: '5',
          push_remote_address: `http://${hostname}:${port}`,
        },
      });
      if (r.err) return fail(pointId, p, r.err);
      return r.status === 200 ? { ok: true, code: 'OK' } : { ok: false, code: 'DEVICE_OFFLINE' };
    },

    /**
     * Modo Push: `GET /push?deviceId&uuid` (o terminal busca comando) e `POST /result?deviceId&uuid` (resultado).
     * O Push usa caminhos fixos e não assina nada, então NÃO há segredo no caminho: a defesa é aceitar só o IP de origem
     * igual ao do ponto (`remoteAddress`), deviceId conhecido, comando entregue uma única vez e resultado só com o mesmo
     * `uuid` e `endpoint` da entrega. Continua mais fraco que o modo direto (um host que falsifique o IP na LAN poderia
     * mentir sobre o resultado): use só quando o Edge não alcança o terminal.
     * @param {{ method: string, path: string, query: Record<string, string>, body?: any, remoteAddress?: string }} req
     * @returns {{ status: number, json?: any }}
     */
    handlePush({ method, path, query, body, remoteAddress }) {
      const hit = byDeviceId(query?.deviceId);
      if (!hit || hit[1].cfg.transport !== 'push') return { status: 404 };
      const [pointId, p] = hit;
      const host = new URL(p.cfg.baseUrl).hostname;
      const from = String(remoteAddress ?? '').replace(/^::ffff:/, '');
      if (!from || from !== host) return { status: 404 };
      const uuid =
        typeof query.uuid === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(query.uuid)
          ? query.uuid
          : null;
      if (!uuid) return { status: 400 };
      p.lastSeen = now().getTime();
      p.aliveSeen = true;
      setOnline(pointId, p, true);

      if (method === 'GET' && path === '/push') {
        const e = p.pending;
        if (!e || e.uuid) return { status: 200 }; // nada a fazer, ou já entregue (resposta vazia)
        e.uuid = uuid;
        return { status: 200, json: e.command };
      }
      if (method === 'POST' && path === '/result') {
        const e = p.pending;
        if (!e || e.uuid !== uuid || !body || typeof body !== 'object') return { status: 404 };
        if (body.endpoint != null && body.endpoint !== e.command.endpoint) return { status: 404 };
        const denied =
          body.error == null && /"status"\s*:\s*"denied"/.test(String(body.response ?? ''));
        finishPending(
          p,
          body.error != null
            ? { ok: false, code: 'DEVICE_OFFLINE' }
            : denied
              ? { ok: false, code: 'INTERLOCK_DENIED' }
              : { ok: true, code: 'OK' },
        );
        return { status: 200, json: {} };
      }
      return { status: 404 };
    },

    /** Lê o estado da porta no terminal (/doors_state.fcgi; o doc oficial cita também door_state: HIPÓTESE do nome). */
    async refreshStatus(pointId) {
      const p = pts.get(pointId);
      if (!p) return null;
      const r = await call(pointId, p, 'doors_state', {});
      if (r.err) {
        fail(pointId, p, r.err);
        return this.getStatus(pointId);
      }
      const list = p.cfg.model === 'sec_box' ? r.json?.sec_boxes : r.json?.doors;
      const item = Array.isArray(list)
        ? list.find(
            (d) =>
              String(d?.id) ===
              String(p.cfg.model === 'sec_box' ? p.cfg.secBoxId : (p.cfg.doorNumber ?? 1)),
          )
        : null;
      if (item && typeof item.open === 'boolean') applyDoorState(pointId, p, item.open);
      return this.getStatus(pointId);
    },

    /**
     * Notificação do Monitor recebida pelo Edge. `path` é o caminho da requisição; `body` o JSON já limitado em tamanho
     * pelo receptor. Rejeita caminho sem o prefixo secreto e dispositivo desconhecido. Nunca repassa cartão, PIN nem biometria.
     * @returns {{ ok: boolean, code: string, emitted?: number }}
     */
    handleNotification(path, body) {
      if (typeof path !== 'string' || !path.startsWith(`${prefix}/`))
        return { ok: false, code: 'FORBIDDEN' };
      const endpoint = path.slice(prefix.length + 1).split('?')[0];
      if (!body || typeof body !== 'object') return { ok: false, code: 'MALFORMED' };
      let emitted = 0;
      const count = (type, id, data) => {
        emit(type, id, data);
        emitted++;
      };

      if (endpoint === 'secbox') {
        const hit = bySecBox(body.secbox?.id);
        if (!hit || typeof body.secbox?.open !== 'boolean')
          return { ok: false, code: 'UNKNOWN_DEVICE' };
        hit[1].lastSeen = now().getTime();
        applyDoorState(hit[0], hit[1], body.secbox.open);
        return { ok: true, code: 'OK' };
      }

      const hit = byDeviceId(body.device_id);
      if (!hit) return { ok: false, code: 'UNKNOWN_DEVICE' };
      const [pointId, p] = hit;
      p.lastSeen = now().getTime();
      setOnline(pointId, p, true);

      if (endpoint === 'device_is_alive') {
        p.aliveSeen = true;
        count('heartbeat', pointId);
      } else if (endpoint === 'door') {
        if (typeof body.door?.open !== 'boolean') return { ok: false, code: 'MALFORMED' };
        applyDoorState(pointId, p, body.door.open);
      } else if (endpoint === 'dao') {
        const changes = Array.isArray(body.object_changes)
          ? body.object_changes.slice(0, MAX_CHANGES)
          : [];
        for (const c of changes) {
          // Só access_logs inseridos; cartões e gabaritos biométricos nunca saem daqui.
          if (c?.object !== 'access_logs' || c.type !== 'inserted' || !c.values) continue;
          const ev = Number(c.values.event);
          const data = {
            controlIdEvent: ev,
            portalId: Number(c.values.portal_id) || null,
            deviceLogId: String(c.values.id ?? ''),
            deviceTime: Number(c.values.time) || null,
          };
          const uid = Number(c.values.user_id);
          if (uid > 0) data.deviceUserId = uid;
          if (ev === EVT_GRANTED) count('access.granted', pointId, data);
          else if (ev === EVT_DENIED || ev === EVT_NOT_IDENTIFIED || ev === EVT_TIMEOUT)
            count('access.denied', pointId, data);
          // demais códigos (pendente, botão, web, desistência) não viram evento de decisão
        }
      } else {
        return { ok: true, code: 'IGNORED', emitted: 0 };
      }
      return { ok: true, code: 'OK', emitted };
    },
  };
}
