import { useEffect, useState } from 'react';
import { MODE_NOTE } from '../lib/format.js';
import {
  BTN_DANGER,
  BTN_PRIMARY,
  BTN_SECONDARY,
  Card,
  Field,
  INPUT_CLASS,
  Notice,
  TopBar,
} from '../ui/parts.jsx';

const fmtTime = (ms) =>
  new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

/** Guarda da configuração: PIN do operador deste aparelho (5 erros = 5 min travado). */
export function Gate({ onVerify, onBack }) {
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await onVerify(pin);
    setBusy(false);
    setPin('');
    if (r.ok) return;
    if (r.lockedUntil) setMsg(`Bloqueado por tentativas erradas até ${fmtTime(r.lockedUntil)}.`);
    else setMsg(`PIN incorreto.${r.remaining ? ` Restam ${r.remaining} tentativas.` : ''}`);
  };
  return (
    <div className="flex h-full flex-col">
      <TopBar title="Configurações" onBack={onBack} />
      <form onSubmit={submit} className="flex-1 p-4">
        <Card className="space-y-4">
          <Field label="PIN do operador">
            <input
              className={INPUT_CLASS}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              autoFocus
              required
            />
          </Field>
          {msg && <Notice tone="error">{msg}</Notice>}
          <button
            type="submit"
            className={`${BTN_PRIMARY} w-full`}
            disabled={busy || pin.length < 6}
          >
            Entrar
          </button>
        </Card>
      </form>
    </div>
  );
}

/** Menu do operador (equivalente funcional ao menu de configurações da referência). */
export function Menu({ identity, face = false, onGo, onExit }) {
  const items = [
    ['config', 'Configurações do Sistema'],
    ['info', 'Informações do Sistema'],
    ['records', 'Registros'],
    ...(face ? [['faceEnroll', 'Cadastro facial']] : []),
  ];
  return (
    <div className="flex h-full flex-col">
      <TopBar title="Configurações" onBack={onExit} />
      <div className="flex-1 overflow-y-auto p-4">
        <Card className="space-y-3 text-center">
          <h2 className="text-2xl font-semibold">Bem-vindo às configurações</h2>
          <p className="text-accent">{identity.label || 'Leitor Zela Pass'}</p>
          <p className="text-sm text-on-kiosk-muted">{MODE_NOTE[identity.mode]}</p>
          <div className="space-y-3 pt-2">
            {items.map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`${BTN_SECONDARY} w-full`}
                onClick={() => onGo(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 min-h-12 text-on-kiosk-muted underline"
            onClick={onExit}
          >
            Sair
          </button>
        </Card>
      </div>
    </div>
  );
}

/** Ajustes, teste de conexão e desativação. */
export function Config({
  identity,
  settings,
  sameOrigin,
  onSave,
  onTest,
  onChangePin,
  onDeactivate,
  onBack,
}) {
  const [f, setF] = useState(settings);
  const [edgeUrl, setEdgeUrl] = useState(identity.edgeUrl);
  const [test, setTest] = useState(null);
  const [pin, setPin] = useState('');
  const [pinMsg, setPinMsg] = useState('');
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setF(settings), [settings]);

  return (
    <div className="flex h-full flex-col">
      <TopBar title="Configurações do Sistema" onBack={onBack} />
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Card className="space-y-4">
          <Field
            label="Endereço do Edge"
            hint={sameOrigin ? 'Página servida pelo próprio Edge.' : undefined}
          >
            <input
              className={INPUT_CLASS}
              value={edgeUrl}
              onChange={(e) => setEdgeUrl(e.target.value)}
              readOnly={sameOrigin}
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>
          <Field label="Conexão">
            <select
              className={INPUT_CLASS}
              value={f.transport}
              onChange={(e) => setF({ ...f, transport: e.target.value })}
            >
              <option value="websocket">WebSocket seguro (padrão)</option>
              <option value="https">HTTPS</option>
              <option value="tcp" disabled>
                TCP/IP (disponível no aplicativo nativo)
              </option>
            </select>
          </Field>
          <Field label="Câmera">
            <select
              className={INPUT_CLASS}
              value={f.facingMode}
              onChange={(e) => setF({ ...f, facingMode: e.target.value })}
            >
              <option value="environment">Traseira</option>
              <option value="user">Frontal</option>
            </select>
          </Field>
          <label className="flex min-h-12 items-center gap-3">
            <input
              type="checkbox"
              className="size-6"
              checked={f.log}
              onChange={(e) => setF({ ...f, log: e.target.checked })}
            />
            <span>Gravar log técnico (sem senhas, códigos nem nomes)</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={() => onSave({ settings: f, edgeUrl: edgeUrl.trim() })}
            >
              Salvar
            </button>
            <button
              type="button"
              className={BTN_SECONDARY}
              onClick={async () => setTest(await onTest(edgeUrl.trim()))}
            >
              Testar conexão
            </button>
          </div>
          {test && <Notice tone={test.ok ? 'info' : 'error'}>{test.text}</Notice>}
        </Card>

        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">PIN do operador</h2>
          <input
            className={INPUT_CLASS}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            placeholder="Novo PIN (6 a 8 dígitos)"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          />
          {pinMsg && (
            <Notice tone={pinMsg.startsWith('PIN alterado') ? 'info' : 'error'}>{pinMsg}</Notice>
          )}
          <button
            type="button"
            className={`${BTN_SECONDARY} w-full`}
            disabled={pin.length < 6}
            onClick={async () => {
              setPinMsg(await onChangePin(pin));
              setPin('');
            }}
          >
            Alterar PIN
          </button>
        </Card>

        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">Desativar este leitor</h2>
          <p className="text-sm text-on-kiosk-muted">
            Apaga a identidade e os dados deste aparelho. Para usar de novo é preciso um novo código
            de ativação. Para bloquear um aparelho perdido, revogue-o no painel (isso vale mesmo sem
            acesso ao aparelho).
          </p>
          {confirming ? (
            <div className="grid grid-cols-2 gap-3">
              <button type="button" className={BTN_DANGER} onClick={onDeactivate}>
                Confirmar
              </button>
              <button type="button" className={BTN_SECONDARY} onClick={() => setConfirming(false)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`${BTN_DANGER} w-full`}
              onClick={() => setConfirming(true)}
            >
              Desativar
            </button>
          )}
        </Card>
      </div>
    </div>
  );
}
