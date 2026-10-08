import { useState } from 'react';
import { QrCode } from 'lucide-react';
import { isEnrollmentCode, validatePin } from '@zela/domain';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Card,
  Field,
  INPUT_CLASS,
  Logo,
  Notice,
} from '../ui/parts.jsx';
import { Scanner } from './Scanner.jsx';

const ERRORS = {
  ENROLL_REJECTED: 'Código inválido, expirado ou já usado. Peça um novo código ao administrador.',
  MALFORMED: 'Dados inválidos. Confira o código e tente de novo.',
  RATE_LIMITED: 'Muitas tentativas. Aguarde um minuto.',
  NO_SNAPSHOT: 'O Edge ainda não sincronizou com a nuvem. Tente de novo em instantes.',
  CLOCK_SKEW: 'Não foi possível acertar a hora com o Edge.',
  UNAVAILABLE: 'Não foi possível falar com o Edge neste endereço.',
};

/** Primeira configuração: endereço do Edge + código de ativação (gerado no painel) + PIN do operador deste aparelho. */
export function Activate({ defaultEdgeUrl, sameOrigin, onActivate, supported }) {
  const [edgeUrl, setEdgeUrl] = useState(defaultEdgeUrl);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!isEnrollmentCode(code.trim()))
      return setError('O código de ativação tem o formato zrd_ seguido de 64 caracteres.');
    const invalid = validatePin(pin);
    if (invalid) return setError(`PIN do operador: ${invalid}`);
    if (pin !== pin2) return setError('Os dois PINs do operador não conferem.');
    setBusy(true);
    const r = await onActivate({
      edgeUrl: edgeUrl.trim(),
      code: code.trim(),
      label: label.trim(),
      pin,
    });
    setBusy(false);
    if (r && !r.ok) setError(ERRORS[r.code] ?? 'Não foi possível ativar este leitor.');
  };

  if (scanning)
    return (
      <Scanner
        title="Aponte para o QR do código de ativação"
        allowManual={false}
        onCode={(text) => {
          if (isEnrollmentCode(text.trim())) {
            setCode(text.trim());
            setScanning(false);
          }
        }}
        onCancel={() => setScanning(false)}
      />
    );

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mx-auto my-6">
        <Logo />
      </div>
      <Card>
        <h1 className="mb-1 text-2xl font-semibold">Ativar este leitor</h1>
        <p className="mb-4 text-sm text-on-kiosk-muted">
          No painel do Zela Acesso, em Leitores Zela Pass, crie um leitor e use o código de ativação
          mostrado (vale 24 horas e serve uma vez).
        </p>
        {!supported && (
          <Notice tone="error">
            Este navegador não oferece a criptografia necessária (Ed25519). Atualize o Chrome, Edge,
            Firefox ou Safari.
          </Notice>
        )}
        <form onSubmit={submit} className="mt-3 space-y-4">
          <Field label="Código de ativação">
            <div className="flex gap-2">
              <input
                className={INPUT_CLASS}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="zrd_…"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                required
              />
              <button
                type="button"
                className={BTN_SECONDARY}
                onClick={() => setScanning(true)}
                aria-label="Ler o código de ativação pela câmera"
              >
                <QrCode aria-hidden="true" />
              </button>
            </div>
          </Field>
          <Field label="Nome deste aparelho (opcional)">
            <input
              className={INPUT_CLASS}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
              placeholder="Ex.: Tablet da portaria"
            />
          </Field>
          <Field
            label="PIN do operador (6 a 8 dígitos)"
            hint="Protege a tela de configurações deste aparelho. Não é a senha das pessoas."
          >
            <input
              className={INPUT_CLASS}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              required
            />
          </Field>
          <Field label="Repita o PIN do operador">
            <input
              className={INPUT_CLASS}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 8))}
              required
            />
          </Field>
          {!sameOrigin && (
            <Field label="Endereço do Edge" hint="Só altere se a página não foi aberta pelo Edge.">
              <input
                className={INPUT_CLASS}
                value={edgeUrl}
                onChange={(e) => setEdgeUrl(e.target.value)}
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </Field>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <button type="submit" className={`${BTN_PRIMARY} w-full`} disabled={busy || !supported}>
            {busy ? 'Ativando…' : 'Ativar leitor'}
          </button>
        </form>
      </Card>
    </div>
  );
}
