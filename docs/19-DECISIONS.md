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
| D-012 | Privilégios por coluna além da RLS (ex.: `sites` sem UPDATE em `tenant_id`; `memberships` sem INSERT em `created_by`) | RLS filtra linhas, não colunas; evita mover dados entre tenants | Aplicada (testada em pgTAP) |
| D-013 | ~~TypeScript fixado em 6.0.x~~ | Substituída por D-017 | Revogada |
| D-014 | Autorização via consulta ao banco (`has_permission`), sem papéis/tenant em claims do JWT | Evita claims desatualizadas após revogação; custo: 1 consulta indexada por checagem (a medir) | Aplicada |
| D-015 | Cadastro público desligado; usuários entram por convite/seed. Provedor de e-mail segue ativo | `[auth.email].enable_signup=false` desliga o LOGIN por e-mail (descoberto em teste) | Aplicada |
| D-017 | Stack em JavaScript/JSX, sem TypeScript (decisão do dono, 2026-10-06). Contratos de domínio documentados com JSDoc. Edge Functions em Deno; Edge Agent local segue em Node (D-005) | Alinhar ao Zela Escola. Custo: perde checagem estática de tipos; compensar com testes, RLS e `rbac:drift`. `database.types.ts` removido | Aplicada |
| D-016 | MFA TOTP habilitado no Auth, mas NÃO exigido (AAL2) em RLS nesta fase | RNF-04 exige MFA para admins em produção: fica PENDENTE para a Fase 9/antes do piloto | Pendente |
