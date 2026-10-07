# 20 — Roadmap técnico

| Fase | Entrega | Saída (gate) |
|---|---|---|
| 0 | Auditoria, docs, matriz, threat model | Docs revisados; bloqueio de plugins resolvido ou aceito |
| 1 | Monorepo, CI, Supabase local isolado, Auth, tenants, RBAC, RLS, UI base | Testes cross-tenant verdes; reset local reproduzível |
| 2 | Sites, zonas, pessoas, grupos, credenciais, pontos, horários, políticas | CRUD com RLS testada |
| 3 | `evaluateAccess`, Access Evidence, eventos append-only, auditoria, anti-passback | Suíte do motor completa; hash encadeado verificável |
| 4 | Edge Agent: enrollment, heartbeat, cache, fila, sync, comandos; Mock Hardware | Cenários offline/duplicidade passando |
| 5 | Visitantes | Ciclo convite→check-out testado |
| 6 | Dashboard operacional, alertas, incidentes, presença (ler Lei 14.967 antes) | E2E operacional |
| 7 | Biometria via provider (Radar/NTs ANPD lidos; 7A–7C feitas, 7D pendente) | Benchmark e parecer jurídico registrados |
| 8 | Hardware real (1 fabricante com documentação) | Teste de bancada documentado |
| 9 | Hardening, backup/restore, DR | Security Audit + Adversarial Verify sem críticos |
| 10–11 | Piloto controlado → RC | Critérios da Seção 58 do Prompt-Mestre |
