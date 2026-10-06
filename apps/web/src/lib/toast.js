// Avisos rapidos (substituem alert()). Funciona fora de componentes React: quem mostra e o <Toaster/>
// montado uma vez no App.

const listeners = new Set();
let seq = 0;

function emit(type, message, durationMs) {
  const toast = { id: ++seq, type, message: String(message ?? ''), durationMs };
  if (listeners.size === 0) return toast.id; // sem Toaster montado (teste unitario)
  listeners.forEach((fn) => fn(toast));
  return toast.id;
}

export const toast = {
  success: (message, durationMs = 4000) => emit('success', message, durationMs),
  error: (message, durationMs = 7000) => emit('error', message, durationMs),
  info: (message, durationMs = 5000) => emit('info', message, durationMs),
};

export function subscribeToasts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
