import { useEffect, useRef, useState } from 'react';
import { BTN_PRIMARY, BTN_SECONDARY, Card, Field, INPUT_CLASS, TopBar } from '../ui/parts.jsx';

const IDLE_MS = 30_000;

/**
 * Número identificador + senha. Volta ao início sozinho se ninguém mexer (a senha não fica na tela).
 * Com `challengeId` (2º fator do ponto, aberto pelo facial) pede só a senha: a pessoa vem do desafio no Edge.
 */
export function Keypad({ onSubmit, onCancel, busy, challengeId = null }) {
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const idle = useRef(null);
  const touch = () => {
    clearTimeout(idle.current);
    idle.current = setTimeout(onCancel, IDLE_MS);
  };
  useEffect(() => {
    touch();
    return () => clearTimeout(idle.current);
  }, []);

  const valid =
    (challengeId !== null || /^[0-9A-Za-z._-]{1,40}$/.test(identifier.trim())) &&
    /^[0-9]{6,8}$/.test(pin);
  const submit = (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    onSubmit(
      challengeId !== null
        ? { method: 'pin', challengeId, pin }
        : { method: 'pin', identifier: identifier.trim().toUpperCase(), pin },
    );
    setPin('');
  };
  const press = (d) => {
    touch();
    setPin((p) => (p.length < 8 ? p + d : p));
  };
  return (
    <div className="flex h-full flex-col">
      <TopBar
        title={challengeId !== null ? 'Confirme com sua senha' : 'Identificação por senha'}
        onBack={onCancel}
      />
      <form onSubmit={submit} onInput={touch} className="flex-1 overflow-y-auto p-4">
        <Card className="space-y-4">
          {challengeId === null && (
            <Field label="Nº identificador">
              <input
                className={INPUT_CLASS}
                name="zp-ident"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={40}
                required
                autoFocus
              />
            </Field>
          )}
          <Field label="Senha (6 a 8 dígitos)">
            <input
              className={INPUT_CLASS}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              name="zp-senha"
              autoComplete="new-password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              maxLength={8}
              required
              autoFocus={challengeId !== null}
              aria-label="Senha"
            />
          </Field>
          <div className="grid grid-cols-3 gap-3" role="group" aria-label="Teclado numérico">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} type="button" className={BTN_SECONDARY} onClick={() => press(d)}>
                {d}
              </button>
            ))}
            <button
              type="button"
              className={BTN_SECONDARY}
              onClick={() => setPin('')}
              aria-label="Limpar senha"
            >
              Limpar
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={() => press('0')}>
              0
            </button>
            <button
              type="button"
              className={BTN_SECONDARY}
              onClick={() => setPin((p) => p.slice(0, -1))}
              aria-label="Apagar último dígito"
            >
              ⌫
            </button>
          </div>
          <button type="submit" className={`${BTN_PRIMARY} w-full`} disabled={!valid || busy}>
            {busy ? 'Enviando…' : 'Confirmar'}
          </button>
        </Card>
      </form>
    </div>
  );
}
