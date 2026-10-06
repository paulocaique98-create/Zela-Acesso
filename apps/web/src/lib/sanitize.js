// Saneamento de contexto de logs (puro, testavel sem ambiente do Supabase).
const SENSITIVE =
  /pass(word)?|pin|token|secret|authorization|api[-_]?key|credential|cookie|biometric|face/i;
/** Remove recursivamente chaves sensiveis e limita profundidade/tamanho. */
export function sanitizeContext(value, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 3) {
    return typeof value === 'string' ? value.slice(0, 300) : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeContext(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !SENSITIVE.test(k))
      .slice(0, 30)
      .map(([k, v]) => [k, sanitizeContext(v, depth + 1)]),
  );
}
