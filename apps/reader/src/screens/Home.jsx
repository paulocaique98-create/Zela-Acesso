import { useEffect, useState } from 'react';
import { Cloud, CloudOff, Lock, QrCode, Radio, Settings, Wifi, WifiOff } from 'lucide-react';
import { Logo } from '../ui/parts.jsx';

const MODE_LABEL = { register_only: 'Somente registro', actuate: 'Com atuação' };

function Indicator({ on, Icon, OffIcon, label }) {
  const Shown = on ? Icon : OffIcon;
  return (
    <span
      role="img"
      aria-label={`${label}: ${on ? 'conectado' : 'sem conexão'}`}
      title={`${label}: ${on ? 'conectado' : 'sem conexão'}`}
      className={on ? 'text-kiosk' : 'text-deny'}
    >
      <Shown size={30} aria-hidden="true" />
    </span>
  );
}

/** Tela de quiosque: relógio (hora do Edge), indicadores, QR/barras e teclado. Facial só existe com o módulo ligado. */
export function Home({ link, clock, identity, onQr, onKeypad, onSettings }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const now = new Date(clock());
  const blocked = link.edge === 'revoked';
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between bg-white px-5 py-3">
        <Logo light />
        <div className="flex items-center gap-4">
          <span className="hidden rounded-full border border-kiosk/30 px-3 py-1 text-sm font-medium text-kiosk sm:inline">
            {MODE_LABEL[link.mode ?? identity.mode] ?? ''}
          </span>
          <Indicator on={link.edge === 'ok'} Icon={Radio} OffIcon={Radio} label="Edge" />
          <Indicator
            on={!link.cloudOffline && link.edge === 'ok'}
            Icon={Cloud}
            OffIcon={CloudOff}
            label="Nuvem"
          />
          <Indicator on={link.network} Icon={Wifi} OffIcon={WifiOff} label="Rede" />
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-3xl font-semibold text-accent">Bem-vindo</p>
        <time
          dateTime={now.toISOString()}
          className="text-7xl font-bold tabular-nums sm:text-8xl"
          aria-label="Hora atual"
        >
          {now.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </time>
        <p className="text-xl text-on-kiosk-muted">
          {now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}
        </p>
        {link.clockDrift && (
          <p
            role="status"
            className="mt-2 rounded-zela-md border border-warn px-3 py-1 text-sm text-amber-200"
          >
            O relógio deste aparelho difere da hora do Edge; a hora mostrada é a do Edge.
          </p>
        )}
        {blocked && (
          <p
            role="alert"
            className="mt-4 rounded-zela-md border border-deny px-4 py-2 text-red-200"
          >
            Este leitor foi revogado. Procure o administrador do sistema.
          </p>
        )}
        {link.edge === 'down' && (
          <p
            role="status"
            className="mt-4 rounded-zela-md border border-warn px-4 py-2 text-amber-200"
          >
            Sem conexão com o Edge. As leituras não são registradas até a conexão voltar.
          </p>
        )}
      </main>

      <nav
        aria-label="Formas de identificação"
        className="flex items-end justify-around gap-4 px-6 pb-6 pt-2"
      >
        <button
          type="button"
          onClick={onQr}
          disabled={blocked}
          className="flex min-w-32 flex-col items-center gap-2 rounded-zela-lg p-3 hover:bg-kiosk-raised focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
        >
          <QrCode size={56} aria-hidden="true" />
          <span className="text-base">QR Code / Barras</span>
        </button>
        <button
          type="button"
          onClick={onKeypad}
          disabled={blocked}
          className="flex min-w-32 flex-col items-center gap-2 rounded-zela-lg p-3 hover:bg-kiosk-raised focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
        >
          <Lock size={56} aria-hidden="true" />
          <span className="text-base">Teclado</span>
        </button>
      </nav>

      <footer className="flex items-center justify-between px-5 pb-4 text-sm text-on-kiosk-muted">
        <span>{identity.label || 'Zela Pass'}</span>
        <button
          type="button"
          onClick={onSettings}
          aria-label="Configurações"
          className="flex size-14 items-center justify-center rounded-full hover:bg-kiosk-raised focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Settings size={36} aria-hidden="true" />
        </button>
      </footer>
    </div>
  );
}
