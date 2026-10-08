import { useEffect, useState } from 'react';
import { Bell, ImageIcon, Palette, Server, Settings, Shield, ShieldAlert, Zap } from 'lucide-react';
import { PlatformMfaCard } from '../auth/MfaGate';
import { useBranding } from '../hooks/useBranding';
import { safeMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { btnNeutral, btnPrimary, card } from './ui';

const TABS = [
  { id: 'appearance', label: 'Aparência (Logo)', icon: Palette },
  { id: 'general', label: 'Geral', icon: Settings },
  { id: 'security', label: 'Segurança', icon: Shield },
  { id: 'integrations', label: 'Integrações', icon: Zap },
  { id: 'notifications', label: 'Notificações', icon: Bell },
  { id: 'backup', label: 'Backup e Manutenção', icon: Server },
];
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_IMAGE_BYTES = 300 * 1024; // o banco limita o texto a 400.000 caracteres (~300 KB em base64)

function Soon() {
  return (
    <span className="ml-2 rounded-full bg-surface-container px-2 py-0.5 text-[10px] font-bold tracking-wider text-on-surface-variant uppercase">
      Em breve
    </span>
  );
}

/** Logo/imagem editavel: escolhe arquivo (PNG, JPG ou WebP ate 300 KB), pre-visualiza e salva em system_settings. */
function ImageSetting({
  settingKey,
  title,
  help,
  current,
  fallbackIcon: Fallback,
  canEdit,
  rounded,
  onSaved,
}) {
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => setValue(current), [current]);

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPT.includes(file.type))
      return setMessage({ ok: false, text: 'Use uma imagem PNG, JPG ou WebP.' });
    if (file.size > MAX_IMAGE_BYTES)
      return setMessage({ ok: false, text: 'A imagem deve ter no máximo 300 KB.' });
    setMessage(null);
    const reader = new FileReader();
    reader.onloadend = () => setValue(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const { error } = await supabase
      .from('system_settings')
      .upsert({ key: settingKey, value: value || '' }, { onConflict: 'key' });
    setSaving(false);
    if (error)
      return setMessage({ ok: false, text: safeMessage(error, 'Não foi possível salvar.') });
    toast.success('Configuração salva.');
    onSaved();
  }

  return (
    <div className={`${card} max-w-2xl !p-6`}>
      <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-zela-md border border-outline-variant bg-surface p-2">
          {value ? (
            <img
              src={value}
              alt={title}
              className={`h-full w-full ${rounded ? 'rounded object-cover' : 'object-contain'}`}
            />
          ) : (
            <Fallback className="text-on-surface-variant" size={32} aria-hidden="true" />
          )}
        </div>
        <div className="w-full flex-1 space-y-2">
          <h2 className="text-sm font-bold text-on-surface">{title}</h2>
          <p className="text-xs text-on-surface-variant">{help}</p>
          {canEdit ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="file"
                accept={ACCEPT.join(',')}
                aria-label={title}
                onChange={onFile}
                className="block min-w-0 flex-1 cursor-pointer text-small text-on-surface-variant file:mr-4 file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-xs file:font-bold file:text-primary hover:file:bg-primary/15"
              />
              {value && (
                <button
                  type="button"
                  onClick={() => setValue('')}
                  className="h-9 shrink-0 rounded-zela-md px-3 text-xs font-bold text-error transition hover:bg-red-50"
                >
                  Remover
                </button>
              )}
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || value === current}
                className={`${btnPrimary} h-9 shrink-0 !text-xs`}
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          ) : (
            <p className="text-xs font-medium text-on-surface-variant">
              Somente o proprietário da plataforma altera esta configuração.
            </p>
          )}
          {message && (
            <p
              role="alert"
              className={`text-xs font-medium ${message.ok ? 'text-emerald-700' : 'text-error'}`}
            >
              {message.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { platformRole } = useWorkspace();
  const canEdit = platformRole === 'platform_owner';
  const [tab, setTab] = useState('appearance');
  const { logo, loginImage, refresh } = useBranding();

  const placeholder = (title, text, extra) => (
    <div className={`${card} max-w-3xl !p-6`}>
      <h2 className="mb-2 flex items-center font-bold text-on-surface">
        {title} <Soon />
      </h2>
      <p className="text-small text-on-surface-variant">{text}</p>
      {extra}
    </div>
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5 border-b border-outline-variant pb-4">
        <div className="shrink-0 rounded-zela-md bg-primary/10 p-2 text-primary">
          <Settings size={18} aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-h2 text-on-surface">Configurações</h1>
          <p className="text-small text-on-surface-variant">Parâmetros globais do Zela Acesso</p>
        </div>
      </div>

      <div role="tablist" className="flex gap-2 overflow-x-auto pb-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-zela-md border px-4 py-2.5 text-sm font-bold whitespace-nowrap transition-all ${tab === id ? 'border-primary/20 bg-primary/10 text-primary shadow-sm' : 'border-transparent text-on-surface-variant hover:bg-surface-container'}`}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'appearance' && (
        <div className="space-y-4">
          <ImageSetting
            settingKey="global_logo"
            title="Logo global (Zela Acesso)"
            help="Imagem (PNG, JPG ou WebP, até 300 KB) usada no cabeçalho do sistema no lugar do ícone padrão."
            current={logo}
            fallbackIcon={ShieldAlert}
            canEdit={canEdit}
            onSaved={() => void refresh()}
          />
          <ImageSetting
            settingKey="login_image_url"
            title="Imagem da tela de login"
            help="Substitui a ilustração padrão (gradiente com escudo) no painel esquerdo da tela de login. Se não for definida, mantém o padrão."
            current={loginImage}
            fallbackIcon={ImageIcon}
            canEdit={canEdit}
            rounded
            onSaved={() => void refresh()}
          />
        </div>
      )}

      {tab === 'general' && (
        <div className={`${card} max-w-3xl !p-6`}>
          <h2 className="mb-4 flex items-center font-bold text-on-surface">
            Dados básicos <Soon />
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[
              ['Nome do sistema', 'Zela Acesso'],
              ['Empresa', 'Arx Tecnologia'],
              ['Idioma padrão', 'Português (Brasil)'],
              ['Fuso horário', 'America/Sao_Paulo'],
            ].map(([l, v]) => (
              <div key={l}>
                <label className="mb-1 block text-xs font-bold text-on-surface-variant uppercase">
                  {l}
                </label>
                <input
                  type="text"
                  disabled
                  value={v}
                  aria-label={l}
                  className="w-full rounded-zela-md border border-outline-variant bg-surface p-2.5 text-sm text-on-surface-variant"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="max-w-3xl space-y-4">
          {placeholder('Política de senhas', 'Exigência e força de senha para novos usuários.')}
          {placeholder(
            'Sessões ativas',
            'Gerenciamento de dispositivos e sessões conectadas.',
            <button
              type="button"
              disabled
              className={`${btnNeutral} mt-4 cursor-not-allowed !text-xs`}
            >
              Encerrar todas as sessões
            </button>,
          )}
          <div className={`${card} max-w-3xl !p-6`}>
            <h2 className="mb-2 font-bold text-on-surface">MFA para administradores</h2>
            <p className="mb-3 text-small text-on-surface-variant">
              Segundo fator obrigatório para a equipe da plataforma (decisão D-016). Nas
              organizações, o dono liga em Membros.
            </p>
            <PlatformMfaCard />
          </div>
        </div>
      )}

      {tab === 'integrations' && (
        <div className="max-w-3xl space-y-4">
          {placeholder('Chaves de API', 'Geração e revogação de tokens para integrações externas.')}
          {placeholder(
            'Webhooks',
            'URLs de callback para eventos do sistema (ex.: decisões de acesso em tempo real).',
          )}
        </div>
      )}

      {tab === 'notifications' && (
        <div className="max-w-3xl space-y-4">
          {placeholder(
            'E-mails automáticos',
            'Gatilhos de e-mail para convites, suspensão e redefinição de senha.',
          )}
          {placeholder(
            'Alertas do sistema',
            'Notificações internas sobre uso de limites e erros operacionais críticos.',
          )}
        </div>
      )}

      {tab === 'backup' && (
        <div className="max-w-3xl space-y-4">
          <div className="rounded-zela-lg border border-l-4 border-outline-variant border-l-amber-400 bg-surface-container-lowest p-6">
            <h2 className="mb-2 flex items-center font-bold text-on-surface">
              Modo manutenção <Soon />
            </h2>
            <p className="mb-4 text-small text-on-surface-variant">
              Bloqueia temporariamente o acesso ao painel das organizações exibindo uma mensagem
              personalizada.
            </p>
            <div className="flex items-center gap-2">
              <div
                className="h-5 w-10 cursor-not-allowed rounded-full bg-outline-variant"
                aria-hidden="true"
              />
              <span className="text-xs font-bold text-on-surface-variant">Sistema online</span>
            </div>
          </div>
          {placeholder(
            'Backup manual',
            'Geração de dump do banco de dados (estruturas e logs).',
            <button
              type="button"
              disabled
              className={`${btnNeutral} mt-4 cursor-not-allowed !text-xs`}
            >
              Solicitar backup
            </button>,
          )}
        </div>
      )}
    </section>
  );
}
