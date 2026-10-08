import { useState } from 'react';
import { DataTable } from '../components/DataTable';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { safeMessage } from '../lib/errors';
import { useQuery } from '../lib/useQuery';
import {
  POINT_ACTUATION_LABEL,
  READER_NAME_MAX,
  READER_STATUS_LABEL,
  validateReaderName,
} from '@zela/domain';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { Guard, Status } from './DataPages';
import { Qr } from './VisitPages';
import { BTN_GHOST, BTN_PRIMARY, Field, INPUT, Modal, PageHead } from './RegistryPages';

const fmt = (iso) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const CREATE_ERRORS = {
  'ponto de acesso inativo': 'O ponto de acesso está inativo.',
  'limite de 100 leitores por unidade': 'Limite de 100 leitores por local atingido.',
};

/** Cria o leitor e devolve o código de ativação (mostrado uma única vez). */
function ReaderForm({ points, onCreated, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ point: points[0]?.id ?? '', name: '' });
  const submit = async (e) => {
    e.preventDefault();
    const invalid = validateReaderName(f.name);
    if (invalid) return toast.error(invalid);
    setBusy(true);
    const { data, error } = await supabase.rpc('create_access_reader', {
      p_point: f.point,
      p_name: f.name.trim(),
    });
    setBusy(false);
    if (error) {
      return toast.error(
        CREATE_ERRORS[error.message] ?? safeMessage(error, 'Não foi possível cadastrar o leitor.'),
      );
    }
    const row = Array.isArray(data) ? data[0] : data;
    onCreated({
      name: f.name.trim(),
      code: row.enrollment_code,
      expires: row.expires_at,
      point: f.point,
    });
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Ponto de acesso">
        <select
          className={INPUT}
          required
          value={f.point}
          onChange={(e) => setF({ ...f, point: e.target.value })}
        >
          {points.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {POINT_ACTUATION_LABEL[p.actuation]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Nome do leitor">
        <input
          className={INPUT}
          required
          minLength={2}
          maxLength={READER_NAME_MAX}
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          placeholder="Ex.: Tablet da portaria"
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN_GHOST} onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className={BTN_PRIMARY} disabled={busy || !f.point}>
          {busy ? 'Criando…' : 'Criar leitor'}
        </button>
      </div>
    </form>
  );
}

const NO_URL_HINT =
  'Informe o endereço do Zela Pass deste local em Locais → Editar para gerar o link.';

function copyText(text, okMessage) {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success(okMessage),
    () => toast.error('Não foi possível copiar.'),
  );
}

/** Código de ativação mostrado uma única vez, em texto e QR. `edgeUrl`: endereço do Zela Pass do local (ou null). */
function ActivationModal({ created, edgeUrl, onClose }) {
  return (
    <Modal title="Código de ativação" onClose={onClose}>
      <div className="space-y-3">
        <p role="note" className="rounded-zela-lg bg-amber-50 p-3 text-sm text-amber-900">
          Abra o endereço do leitor Zela Pass no tablet de <strong>{created.name}</strong> e informe
          este código. Ele vale até {fmt(created.expires)}, serve para um único aparelho e é
          mostrado uma única vez: não fica guardado de forma legível.
        </p>
        <Qr text={created.code} />
        <code className="block break-all text-center text-xs select-all">{created.code}</code>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={BTN_GHOST}
            onClick={() => copyText(created.code, 'Código copiado.')}
          >
            Copiar código
          </button>
          <button
            type="button"
            className={BTN_GHOST}
            onClick={() =>
              edgeUrl
                ? copyText(
                    `${edgeUrl}/#codigo=${created.code}`,
                    'Link copiado. Ele já leva o código de ativação: envie só ao responsável pelo aparelho.',
                  )
                : toast.error(NO_URL_HINT)
            }
          >
            Copiar link de ativação
          </button>
        </div>
        <div className="flex justify-end">
          <button type="button" className={BTN_PRIMARY} onClick={onClose}>
            Já anotei
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RevokeForm({ reader, onDone, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('revoke_access_reader', {
      p_reader: reader.id,
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (error) return toast.error(safeMessage(error, 'Não foi possível revogar o leitor.'));
    toast.success('Leitor revogado. O Edge deixa de aceitá-lo na próxima sincronização.');
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-on-surface-variant">
        Revogar <strong>{reader.name}</strong> é irreversível: para voltar a usar o aparelho é
        preciso criar um novo leitor e ativá-lo de novo. Vale a partir da próxima sincronização do
        Edge (alguns minutos); o histórico de marcações é preservado.
      </p>
      <Field label="Motivo (mínimo 5 caracteres)">
        <input
          className={INPUT}
          required
          minLength={5}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN_GHOST} onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="submit"
          className={`${BTN_PRIMARY} bg-error`}
          disabled={busy || reason.trim().length < 5}
        >
          {busy ? 'Revogando…' : 'Revogar leitor'}
        </button>
      </div>
    </form>
  );
}

export function ReadersPage() {
  const { current, allowed, allowedInAnyScope } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(/** @type {any} */ (null));
  const [revoking, setRevoking] = useState(/** @type {any} */ (null));
  const q = useQuery(async () => {
    const tenantId = current?.id ?? '';
    const [r, p, s] = await Promise.all([
      supabase
        .from('access_readers')
        .select(
          'id, site_id, access_point_id, name, status, enrollment_expires_at, device_label, enrolled_at, revoked_at, revoked_reason',
        )
        .eq('tenant_id', tenantId)
        .order('name')
        .limit(500),
      supabase
        .from('access_points')
        .select('id, site_id, name, status, actuation')
        .eq('tenant_id', tenantId)
        .order('name')
        .limit(500),
      supabase
        .from('sites')
        .select('id, name, zela_pass_url')
        .eq('tenant_id', tenantId)
        .order('name')
        .limit(200),
    ]);
    for (const x of [r, p, s]) if (x.error) throw x.error;
    return { readers: r.data, points: p.data, sites: s.data };
  }, [current?.id]);
  const done = () => {
    setCreating(false);
    setRevoking(null);
    q.reload();
  };
  return (
    <Guard permission="reader:read" siteLevel>
      <PageHead
        title="Leitores Zela Pass"
        canCreate={allowedInAnyScope('reader:create')}
        onNew={() => setCreating(true)}
      >
        <p className="text-sm text-on-surface-variant">
          Tablets e celulares de portaria que identificam a pessoa (senha, QR Code ou código de
          barras) e registram a entrada ou saída. O leitor não decide nada: quem decide é o Edge,
          com as mesmas regras do restante do sistema.
        </p>
        <Status q={q}>
          {({ readers, points, sites }) => {
            const pointOf = new Map(points.map((p) => [p.id, p]));
            const siteName = new Map(sites.map((s) => [s.id, s.name]));
            const siteUrl = new Map(sites.map((s) => [s.id, s.zela_pass_url]));
            const usable = points.filter(
              (p) => p.status === 'active' && allowed('reader:create', p.site_id),
            );
            return (
              <>
                <DataTable
                  caption="Leitores"
                  headers={['Nome', 'Local / ponto', 'Modo', 'Situação', 'Detalhe', 'Ações']}
                  empty="Nenhum leitor cadastrado."
                  rows={readers.map((r) => {
                    const p = pointOf.get(r.access_point_id);
                    return [
                      r.name,
                      `${siteName.get(r.site_id) ?? '—'} / ${p?.name ?? '—'}`,
                      p?.actuation === 'none' ? 'Somente registro' : 'Com atuação',
                      READER_STATUS_LABEL[r.status],
                      r.status === 'pending'
                        ? `Código válido até ${fmt(r.enrollment_expires_at)}`
                        : r.status === 'active'
                          ? `Ativado em ${fmt(r.enrolled_at)}${r.device_label ? ` (${r.device_label})` : ''}`
                          : `Revogado em ${fmt(r.revoked_at)}: ${r.revoked_reason ?? ''}`,
                      r.status !== 'revoked' ? (
                        <div key={r.id} className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={BTN_GHOST}
                            onClick={() =>
                              siteUrl.get(r.site_id)
                                ? copyText(siteUrl.get(r.site_id), 'Link do Zela Pass copiado.')
                                : toast.error(NO_URL_HINT)
                            }
                          >
                            Copiar link
                          </button>
                          {allowed('reader:revoke', r.site_id) && (
                            <button
                              type="button"
                              className={`${BTN_GHOST} text-error`}
                              onClick={() => setRevoking(r)}
                            >
                              Revogar
                            </button>
                          )}
                        </div>
                      ) : null,
                    ];
                  })}
                />
                {creating && (
                  <Modal title="Novo leitor" onClose={() => setCreating(false)}>
                    {usable.length === 0 ? (
                      <p>Não há ponto de acesso ativo onde você possa cadastrar leitores.</p>
                    ) : (
                      <ReaderForm
                        points={usable}
                        onCancel={() => setCreating(false)}
                        onCreated={(c) => {
                          setCreating(false);
                          setCreated(c);
                          q.reload();
                        }}
                      />
                    )}
                  </Modal>
                )}
                {revoking && (
                  <Modal title="Revogar leitor" onClose={() => setRevoking(null)}>
                    <RevokeForm
                      reader={revoking}
                      onDone={done}
                      onCancel={() => setRevoking(null)}
                    />
                  </Modal>
                )}
                {created && (
                  <ActivationModal
                    created={created}
                    edgeUrl={siteUrl.get(pointOf.get(created.point)?.site_id) ?? null}
                    onClose={() => setCreated(null)}
                  />
                )}
              </>
            );
          }}
        </Status>
      </PageHead>
    </Guard>
  );
}
