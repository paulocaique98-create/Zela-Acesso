// Endereco do Zela Pass sugerido a partir do nome da organizacao e do local. Funcao pura (sem rede, sem DNS): o nome so
// funciona de verdade depois que o DNS e o certificado do dominio-base existirem (ver docs/27-FACE-DESENHO-OPERACAO.md).

/** Dominio-base do piloto (subdominio gratuito do DuckDNS). Trocar aqui quando houver dominio proprio. */
export const ZELA_PASS_BASE_DOMAIN = 'duckdns.org';

/** Cada rotulo de DNS tem no maximo 63 caracteres. */
const LABEL_MAX = 63;

/** Sufixos societarios que nao ajudam a identificar a organizacao no endereco. */
const COMPANY_SUFFIX = /(?:^|-)(?:ltda|me|epp|eireli|sa|s-a|ss)$/;

/**
 * Texto livre -> rotulo de DNS: sem acento, minusculo, letras/numeros separados por hifen, sem hifen nas pontas.
 * @param {string} text
 * @returns {string}
 */
export function dnsSlug(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Endereco sugerido (https, sem caminho): `https://<organizacao>-<local>.<dominio-base>`.
 * Retorna '' se faltar o nome do local.
 * @param {string} orgName
 * @param {string} siteName
 * @param {string} [baseDomain]
 * @returns {string}
 */
export function suggestZelaPassUrl(orgName, siteName, baseDomain = ZELA_PASS_BASE_DOMAIN) {
  const site = dnsSlug(siteName);
  if (!site) return '';
  let org = dnsSlug(orgName);
  while (COMPANY_SUFFIX.test(org)) org = org.replace(COMPANY_SUFFIX, '');
  const label = [org, site].filter(Boolean).join('-').slice(0, LABEL_MAX).replace(/-+$/g, '');
  return label ? `https://${label}.${baseDomain}` : '';
}
