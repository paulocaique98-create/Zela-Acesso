/**
 * Mensagem segura para a tela a partir de um erro do Supabase/Postgres. Nunca expoe texto bruto do banco:
 * so repassa a mensagem das regras de negocio nossas (RAISE EXCEPTION sem errcode = P0001, em portugues).
 * @param {{ code?: string, message?: string } | null | undefined} err
 * @param {string} fallback
 */
export function safeMessage(err, fallback) {
  if (!err) return fallback;
  switch (err.code) {
    case 'P0001':
      return err.message && err.message.length <= 300 ? err.message : fallback;
    case '42501':
      return 'Você não tem permissão para esta ação.';
    case '23505':
      return 'Já existe um registro com esses dados.';
    case '23514':
    case '22P02':
      return 'Algum dado informado é inválido.';
    case '23503':
      return 'Registro relacionado não encontrado.';
    default:
      return fallback;
  }
}
