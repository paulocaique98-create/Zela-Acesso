# 15 — Plano de Testes

Fase 1 executada (ver ZELA_ACESSO_STATUS): pgTAP 84, Vitest 27, E2E 10. Demais camadas: PLANEJADO.

| Camada | Ferramenta | Cobertura mínima |
|---|---|---|
| Unitário domínio | Vitest | permitido, negado, credencial expirada, fora de horário, zona proibida, anti-passback, visitante expirado, feriado, timezone/DST, dispositivo revogado; testes de propriedade (nunca ALLOW com pessoa/credencial inativa) |
| Banco/RLS | pgTAP ou SQL de teste via Supabase CLI | CRUD cross-tenant negado (SELECT/INSERT/UPDATE/DELETE), papéis, append-only (UPDATE/DELETE bloqueados), Storage por tenant |
| Integração | Vitest + Supabase local | Edge Function ↔ banco, idempotência, replay, webhooks |
| Edge Agent | Vitest + simulação | perda de internet, restart, fila corrompida, duplicidade, fora de ordem, relógio errado, revogação offline, conflito de versão |
| E2E | Playwright contra localhost | fluxo do vertical slice, visitante, offline/reconexão, isolamento multi-tenant, auditoria |
| Segurança | Security Audit / Adversarial Verify (quando instaladas) | checkpoints no fim das Fases 1, 3, 4, 9 |

Gate de CI: lint → typecheck → unit → RLS/integração → build → E2E.
