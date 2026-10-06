# 19 — Decisões Arquiteturais

| ID | Decisão | Justificativa | Status |
|---|---|---|---|
| D-001 | Monorepo pnpm (apps/web, apps/edge-agent, packages/*) | pnpm 10 já instalado; simples para equipe pequena | Proposta |
| D-002 | Supabase local com `project_id=zela-acesso-local` e portas 55xxx explícitas | CLI 2.109.1 sem modo `stack` (<2.119); evitar colisão com Projeto_Zela | Proposta |
| D-003 | Motor `evaluateAccess` puro e determinístico em `packages/domain`, sem I/O | Testável, explicável, reutilizável no Edge e na nuvem | Proposta |
| D-004 | Eventos append-only com hash encadeado por tenant/dispositivo | Detectar adulteração; sem alegar valor jurídico | Proposta |
| D-005 | Edge Agent em Node + SQLite | Fila persistente offline; mesma linguagem do domínio | A validar (benchmark em Windows) |
| D-006 | At-least-once + idempotência (device_event_id) | Rede não garante exactly-once | Proposta |
| D-007 | Biometria só via `BiometricProvider`; Human é candidato, não decisão | Benchmark antes de fixar | Proposta |
| D-008 | Sem Redis/Kafka/K8s no MVP | Custo e simplicidade; Postgres + Edge Functions bastam | Proposta |
| D-009 | Verificar se Node 24 é LTS vigente antes de fixar `engines` | Regra de verificar versões | Pendente |
| D-010 | Git isolado na pasta do projeto, sem remote até decisão do dono | Evitar commits no repo Painel-SDR da home | Aplicada |
| D-011 | Fase 0 aprovada pelo dono (2026-10-06); skills supabase, postgres-best-practices, playwright-skill e security-audit dispensadas. Usar docs oficiais e as skills instaladas (skill-security-scan, adversarial-verify, context-warden) | Sem origem verificável; sem instalar fonte não vetada | Aplicada |
