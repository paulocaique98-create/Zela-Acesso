# 04 — Arquitetura proposta

```
Web (React/Vite/TS strict)
   │ HTTPS, JWT Supabase
Supabase: Auth · Postgres+RLS · Storage privado · Realtime · Edge Functions
   │ TLS (mTLS ou token de device com rotação)
Edge Agent (Node + SQLite): policy cache · credential cache · fila · idempotência
   │
HAL (domínio → abstração) → Driver → Protocolo/SDK → Hardware
        └─ MockHardwareAdapter (somente dev/teste)
```

## Pacotes
- `packages/domain`: `evaluateAccess`, tipos, códigos de motivo. Puro, sem I/O, compartilhado nuvem+edge.
- `packages/contracts`: schemas (zod) de eventos/comandos/API versionados.
- `packages/security`: hash de PIN, geração de tokens, assinatura de comandos, cadeia de hash.
- `packages/device-drivers`: interface + mock; adapters reais só com documentação oficial do fabricante.
- `apps/web`, `apps/edge-agent`, `supabase/` (migrations, functions, seed, tests).

## Princípios
1. Decisão física determinística; nunca IA generativa.
2. Tenant sempre derivado da sessão/credencial do device, nunca do payload.
3. Eventos at-least-once + idempotência; histórico append-only com hash encadeado.
4. Offline-first: o Edge decide com política sincronizada; política offline explícita por ponto.
5. Comando físico só via Edge Function autorizada → fila de comandos assinada → agent.
6. Ambiente local isolado: `project_id=zela-acesso-local`, portas 55xxx, guardas contra apontar para remoto.
7. Sem serviços extras (Redis/Kafka/K8s) até haver métrica que justifique.

## Primeiro vertical slice (Fase 3–4)
Web → Edge Function `access/evaluate` → motor → persistência → Edge Agent → Mock Hardware → evento físico → sync → Access Evidence.

## Riscos de arquitetura abertos
Runtime do SQLite no Windows (D-005), mTLS vs token rotativo para agents, particionamento de eventos (decidir com volume).
