import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { READER_OUTCOME_LABEL } from '@zela/domain';
import { createReaderClient } from './lib/client.js';
import { ed25519Supported, generateDeviceKeys } from './lib/crypto.js';
import { openKv } from './lib/db.js';
import { describeStatus } from './lib/format.js';
import { setOperatorPin, verifyOperatorPin } from './lib/operator.js';
import { classifyScanned, startWedgeScanner } from './lib/scan.js';
import {
  DEFAULT_SETTINGS,
  addLog,
  addRecord,
  loadLog,
  loadRecords,
  loadSettings,
  saveSettings,
  wipeDevice,
} from './lib/store.js';
import { TransportError, createTransport } from './lib/transport.js';
import { Activate } from './screens/Activate.jsx';
import { Home } from './screens/Home.jsx';
import { FaceEnroll, FaceScan } from './screens/Face.jsx';
import { Info } from './screens/Info.jsx';
import { Keypad } from './screens/Keypad.jsx';
import { Records } from './screens/Records.jsx';
import { Result } from './screens/Result.jsx';
import { Scanner } from './screens/Scanner.jsx';
import { Config, Gate, Menu } from './screens/Settings.jsx';

const POLL_MS = 30_000;
const SAME_CODE_MS = 4_000;
const REFUSAL_LABEL = {
  REVOKED: 'Leitor revogado',
  UNAUTHORIZED: 'Aparelho não reconhecido',
  RATE_LIMITED: 'Aguarde um instante',
  NO_SNAPSHOT: 'Edge sem dados da nuvem',
  POINT_UNAVAILABLE: 'Ponto de acesso indisponível',
  MALFORMED: 'Leitura inválida',
};

const sameOrigin = (url) => {
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
};

export function App() {
  const kv = useMemo(() => openKv(), []);
  const startedAt = useRef(Date.now());
  const [boot, setBoot] = useState('loading'); // loading | ready
  const [supported, setSupported] = useState(true);
  const [identity, setIdentity] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [records, setRecords] = useState([]);
  const [log, setLog] = useState([]);
  const [screen, setScreen] = useState('home');
  const [result, setResult] = useState(null);
  const [challengeId, setChallengeId] = useState(null); // 2º fator: desafio aberto pelo facial (só em memória)
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [link, setLink] = useState({
    edge: 'down',
    network: navigator.onLine,
    cloudOffline: false,
  });
  const lastCode = useRef({ text: '', at: 0 });

  const transport = useMemo(
    () =>
      identity ? createTransport({ baseUrl: identity.edgeUrl, prefer: settings.transport }) : null,
    [identity, settings.transport],
  );
  const client = useMemo(
    () =>
      transport
        ? createReaderClient({
            transport,
            identity: { readerId: identity.readerId, privateKey: identity.privateKey },
          })
        : null,
    [transport, identity],
  );

  // ---- inicialização
  useEffect(() => {
    (async () => {
      setSupported(await ed25519Supported());
      const [id, st, rec, lg] = await Promise.all([
        kv.get('identity'),
        loadSettings(kv),
        loadRecords(kv),
        loadLog(kv),
      ]);
      setIdentity(id ?? null);
      setSettings(st);
      setRecords(rec);
      setLog(lg);
      setBoot('ready');
    })().catch(() => setBoot('ready'));
  }, [kv]);

  const note = useCallback(
    async (event, code) => {
      await addLog(kv, settings.log, event, code);
      if (settings.log) setLog(await loadLog(kv));
    },
    [kv, settings.log],
  );

  // ---- conectividade (Edge, nuvem, rede) e relógio
  const refresh = useCallback(async () => {
    if (!client) return;
    let res = null;
    try {
      res = await client.status();
    } catch (e) {
      if (!(e instanceof TransportError)) throw e;
    }
    setLink({
      edge: res?.ok ? 'ok' : res?.code === 'REVOKED' ? 'revoked' : res ? 'error' : 'down',
      mode: res?.mode,
      face: res?.face === true,
      cloudOffline: res?.offline === true,
      network: navigator.onLine,
      clockDrift: Math.abs(client.clockOffsetMs()) > 60_000,
      lastOkAt: res?.ok ? Date.now() : undefined,
    });
    void note('status', res?.code ?? 'sem resposta');
  }, [client, note]);

  useEffect(() => {
    if (!client || screen !== 'home') return undefined;
    void refresh();
    const t = setInterval(refresh, POLL_MS);
    const online = () => void refresh();
    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
    };
  }, [client, screen, refresh]);

  // mantém a tela acesa no quiosque
  useEffect(() => {
    if (!identity || !('wakeLock' in navigator)) return undefined;
    let lock = null;
    const acquire = () =>
      navigator.wakeLock
        .request('screen')
        .then((l) => (lock = l))
        .catch(() => {});
    void acquire();
    const vis = () => document.visibilityState === 'visible' && void acquire();
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      void lock?.release();
    };
  }, [identity]);

  // ---- leitura (um único caminho para senha, QR, barras e leitor-teclado)
  const read = useCallback(
    async (reading) => {
      if (!client || busy) return;
      setBusy(true);
      let res;
      try {
        res = await client.attempt(reading);
      } catch {
        res = { ok: false, code: 'UNAVAILABLE', outcome: 'UNAVAILABLE' };
      }
      const outcome = res.ok ? res.outcome : (res.outcome ?? 'UNAVAILABLE');
      setChallengeId(null);
      if (res.ok && res.challengeId) {
        // Ponto com 2º fator: o facial foi reconhecido; falta a senha da mesma pessoa. Sem tela de resultado ainda.
        setChallengeId(res.challengeId);
        setBusy(false);
        setScreen('confirm');
        return;
      }
      const delivered = res.code !== 'UNAVAILABLE';
      setResult({
        outcome: res.ok ? outcome : 'NOT_AUTHORIZED',
        label: res.ok
          ? (res.label ?? READER_OUTCOME_LABEL[outcome])
          : res.code === 'UNAVAILABLE'
            ? READER_OUTCOME_LABEL.UNAVAILABLE
            : (REFUSAL_LABEL[res.code] ?? 'Não foi possível registrar'),
        direction: res.direction,
        code: res.code,
      });
      if (res.code === 'UNAVAILABLE') setLink((l) => ({ ...l, edge: 'down' }));
      if (res.code === 'REVOKED') setLink((l) => ({ ...l, edge: 'revoked' }));
      setRecords(
        await addRecord(kv, {
          at: Date.now(),
          method: reading.method,
          outcome: res.ok ? outcome : res.code === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'NOT_AUTHORIZED',
          delivered,
        }),
      );
      void note('attempt', res.code);
      setBusy(false);
      setScreen('home');
    },
    [client, busy, kv, note],
  );

  const onScanned = useCallback(
    (text, format) => {
      const now = Date.now();
      if (lastCode.current.text === text && now - lastCode.current.at < SAME_CODE_MS) return;
      lastCode.current = { text, at: now };
      void read({ method: classifyScanned(text, format), value: text });
    },
    [read],
  );

  useEffect(() => {
    if (!identity || screen !== 'home') return undefined;
    return startWedgeScanner({
      onCode: (text) => onScanned(text, null),
      enabled: () => !busy && !result && link.edge !== 'revoked',
    });
  }, [identity, screen, busy, result, link.edge, onScanned]);

  // ---- ativação
  const activate = async ({ edgeUrl, code, label, pin }) => {
    let url;
    try {
      url = new URL(edgeUrl);
    } catch {
      return { ok: false, code: 'UNAVAILABLE' };
    }
    if (
      url.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      !sameOrigin(edgeUrl)
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const keys = await generateDeviceKeys();
    const temp = createReaderClient({
      transport: createTransport({ baseUrl: url.origin, prefer: 'https' }),
    });
    let res;
    try {
      res = await temp.enroll({
        code,
        label,
        publicKeyHex: keys.publicKeyHex,
        privateKey: keys.privateKey,
      });
    } catch (e) {
      if (e instanceof TransportError) return { ok: false, code: 'UNAVAILABLE' };
      throw e;
    }
    if (!res?.ok) return { ok: false, code: res?.code ?? 'UNAVAILABLE' };
    const pinError = await setOperatorPin(kv, pin);
    if (pinError) return { ok: false, code: 'MALFORMED' };
    const id = {
      readerId: res.readerId,
      privateKey: keys.privateKey,
      publicKeyHex: keys.publicKeyHex,
      accessPointId: res.accessPointId,
      mode: res.mode,
      direction: res.direction,
      edgeUrl: url.origin,
      label,
      enrolledAt: new Date().toISOString(),
    };
    await kv.set('identity', id);
    void navigator.storage?.persist?.(); // evita o navegador apagar a identidade por falta de espaço
    setIdentity(id);
    setScreen('home');
    return { ok: true };
  };

  const flashNow = (text) => {
    setFlash(text);
    setTimeout(() => setFlash(''), 2500);
  };

  if (boot === 'loading') return <p className="p-8 text-center text-on-kiosk-muted">Carregando…</p>;

  if (!identity)
    return (
      <Activate
        defaultEdgeUrl={window.location.origin}
        sameOrigin={
          sameOrigin(window.location.origin) && window.location.protocol.startsWith('http')
        }
        supported={supported}
        onActivate={activate}
      />
    );

  const back = () => setScreen('home');
  return (
    <>
      {screen === 'home' && (
        <Home
          link={link}
          clock={() => client?.edgeNow() ?? Date.now()}
          identity={identity}
          onQr={() => setScreen('scanner')}
          onKeypad={() => setScreen('keypad')}
          onFace={() => setScreen('face')}
          onSettings={() => setScreen('gate')}
        />
      )}
      {screen === 'keypad' && <Keypad busy={busy} onSubmit={read} onCancel={back} />}
      {screen === 'confirm' && challengeId && (
        <Keypad busy={busy} challengeId={challengeId} onSubmit={read} onCancel={back} />
      )}
      {screen === 'face' && <FaceScan onRead={read} onCancel={back} />}
      {screen === 'faceEnroll' && (
        <FaceEnroll
          onBack={() => setScreen('menu')}
          onSubmit={async (p) => {
            const res = await client.faceEnroll(p);
            void note('face_enroll', res?.code ?? 'sem resposta');
            return res;
          }}
        />
      )}
      {screen === 'scanner' && (
        <Scanner facingMode={settings.facingMode} onCode={onScanned} onCancel={back} />
      )}
      {screen === 'gate' && (
        <Gate
          onBack={back}
          onVerify={async (pin) => {
            const r = await verifyOperatorPin(kv, pin);
            if (r.ok) setScreen('menu');
            return r;
          }}
        />
      )}
      {screen === 'menu' && (
        <Menu identity={identity} face={link.face === true} onGo={setScreen} onExit={back} />
      )}
      {screen === 'config' && (
        <Config
          identity={identity}
          settings={settings}
          sameOrigin={sameOrigin(identity.edgeUrl)}
          onBack={() => setScreen('menu')}
          onSave={async ({ settings: s, edgeUrl }) => {
            await saveSettings(kv, s);
            setSettings(s);
            if (edgeUrl && edgeUrl !== identity.edgeUrl) {
              const id = { ...identity, edgeUrl };
              await kv.set('identity', id);
              setIdentity(id);
            }
            flashNow('Configurações salvas.');
          }}
          onTest={async (edgeUrl) => {
            try {
              const t = createTransport({ baseUrl: edgeUrl, prefer: settings.transport });
              const c = createReaderClient({
                transport: t,
                identity: { readerId: identity.readerId, privateKey: identity.privateKey },
              });
              const res = await c.status();
              t.close();
              return describeStatus(res);
            } catch {
              return describeStatus(null);
            }
          }}
          onChangePin={async (pin) => (await setOperatorPin(kv, pin)) ?? 'PIN alterado.'}
          onDeactivate={async () => {
            await wipeDevice(kv);
            transport?.close();
            setIdentity(null);
            setRecords([]);
            setLog([]);
            setSettings(DEFAULT_SETTINGS);
            setScreen('home');
          }}
        />
      )}
      {screen === 'info' && (
        <Info
          identity={identity}
          link={link}
          records={records}
          log={log}
          transportKind={transport?.kind() ?? 'https'}
          startedAt={startedAt.current}
          clockOffsetMs={client?.clockOffsetMs() ?? 0}
          onBack={() => setScreen('menu')}
        />
      )}
      {screen === 'records' && <Records records={records} onBack={() => setScreen('menu')} />}
      {result && <Result result={result} onClose={() => setResult(null)} />}
      {flash && (
        <p
          role="status"
          className="fixed inset-x-4 bottom-6 z-40 mx-auto max-w-md rounded-zela-lg bg-ok px-4 py-3 text-center font-medium text-white"
        >
          {flash}
        </p>
      )}
    </>
  );
}
