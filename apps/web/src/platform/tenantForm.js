// Regras puras do formulario de organizacao (testaveis sem React).
import { formatCep, formatCnpj, isValidCnpj, onlyDigits } from '../lib/br';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const MIN_OWNER_PASSWORD = 12;
export const UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
];

/** @param {string} name */
export function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

export const EMPTY_FORM = {
  name: '',
  slug: '',
  slugTouched: false,
  legal_name: '',
  tax_id: '',
  municipal_registration: '',
  contact_email: '',
  contact_phone: '',
  postal_code: '',
  street: '',
  street_number: '',
  address_complement: '',
  district: '',
  city: '',
  state: '',
  notes: '',
  max_sites: '',
  max_people: '',
  owner_name: '',
  owner_email: '',
  owner_password: '',
};

/** @param {{ name: string, slug: string, limits?: Record<string, number> }} tenant @param {Record<string, string | null> | undefined} details */
export function formFromTenant(tenant, details) {
  const d = details ?? {};
  const text = (k) => d[k] ?? '';
  return {
    ...EMPTY_FORM,
    name: tenant.name,
    slug: tenant.slug,
    slugTouched: true,
    legal_name: text('legal_name'),
    tax_id: formatCnpj(text('tax_id')),
    municipal_registration: text('municipal_registration'),
    contact_email: text('contact_email'),
    contact_phone: text('contact_phone'),
    postal_code: formatCep(text('postal_code')),
    street: text('street'),
    street_number: text('street_number'),
    address_complement: text('address_complement'),
    district: text('district'),
    city: text('city'),
    state: text('state'),
    notes: text('notes'),
    max_sites: tenant.limits?.max_sites != null ? String(tenant.limits.max_sites) : '',
    max_people: tenant.limits?.max_people != null ? String(tenant.limits.max_people) : '',
  };
}

/** Dados cadastrais enviados ao banco (o banco normaliza e valida de novo). */
export function buildDetails(form) {
  return {
    legal_name: form.legal_name.trim(),
    tax_id: onlyDigits(form.tax_id),
    municipal_registration: form.municipal_registration.trim(),
    contact_email: form.contact_email.trim(),
    contact_phone: form.contact_phone.trim(),
    postal_code: onlyDigits(form.postal_code),
    street: form.street.trim(),
    street_number: form.street_number.trim(),
    address_complement: form.address_complement.trim(),
    district: form.district.trim(),
    city: form.city.trim(),
    state: form.state.trim().toUpperCase(),
    notes: form.notes.trim(),
  };
}

export function buildLimits(form) {
  const out = {};
  if (form.max_sites !== '') out.max_sites = Number(form.max_sites);
  if (form.max_people !== '') out.max_people = Number(form.max_people);
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mensagem de erro (ou null) antes de enviar. */
export function validateForm(form, creating) {
  if (form.name.trim().length < 2) return 'Informe o nome fantasia (mínimo 2 caracteres).';
  if (form.tax_id && !isValidCnpj(form.tax_id)) return 'CNPJ inválido.';
  if (form.contact_email && !EMAIL_RE.test(form.contact_email.trim()))
    return 'E-mail da organização inválido.';
  if (form.postal_code && onlyDigits(form.postal_code).length !== 8) return 'CEP inválido.';
  for (const k of ['max_sites', 'max_people']) {
    if (form[k] !== '' && !(Number.isInteger(Number(form[k])) && Number(form[k]) >= 0))
      return 'Limites devem ser números inteiros não negativos.';
  }
  if (!creating) return null;
  if (!SLUG_RE.test(form.slugTouched ? form.slug : slugify(form.name))) {
    return 'Identificador inválido: use letras minúsculas, números e hífen (2 a 63).';
  }
  if (!EMAIL_RE.test(form.owner_email.trim())) return 'Informe o e-mail do responsável.';
  if (form.owner_password) {
    if (!form.owner_name.trim()) return 'Informe o nome do responsável.';
    if (form.owner_password.length < MIN_OWNER_PASSWORD)
      return `A senha do responsável deve ter no mínimo ${MIN_OWNER_PASSWORD} caracteres.`;
  }
  return null;
}

/** Mensagens genericas por codigo do Postgres para o caminho "responsavel ja tem conta". @param {{ code?: string } | null} err */
export function createErrorMessage(err) {
  if (!err) return null;
  if (err.code === '42501') return 'Você não tem permissão para criar organizações.';
  if (err.code === '23503')
    return 'Não existe usuário com esse e-mail. Informe uma senha para criar a conta do responsável.';
  if (err.code === '23505') return 'Já existe uma organização com esse identificador.';
  if (err.code === '23514')
    return 'Algum dado informado é inválido (CNPJ, CEP, UF, nome ou identificador).';
  return 'Não foi possível criar a organização.';
}
