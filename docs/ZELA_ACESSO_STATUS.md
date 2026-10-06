# Status — Zela Acesso
Atualizado: 2026-10-06

- **Fase 0**: aprovada pelo dono em 2026-10-06 (docs 01–04, 07, 14, 15, 19, 20, CLAUDE.md).
- **Fase 1** (fundação): **implementada e testada localmente; gate cumprido; aguardando aprovação do dono**.
- Skills de projeto instaladas: skill-security-scan, adversarial-verify, context-warden. Dispensadas pelo dono: supabase, postgres-best-practices, playwright-skill, security-audit (D-011).

## Entregue na Fase 1 (evidência: executado em 2026-10-06, máquina local)
| Item | Estado | Evidência |
|---|---|---|
| Monorepo pnpm (apps/web, packages/domain), TS strict, ESLint, Prettier | TESTADO | `pnpm lint`, `format:check`, `typecheck` limpos |
| Supabase local isolado (`zela-acesso-local`, 553xx) convivendo com o Zela Escola | TESTADO | 9 containers nossos + 11 do Zela Escola ativos; wrapper recusa alvo errado |
| Schema: tenants, profiles, memberships, platform_admins, sites, role_permissions, audit_log | TESTADO | migration `20261006120000_foundation.sql` aplica do zero (`db reset`) |
| RLS + RBAC (recurso:ação + escopo por site), hierarquia de papéis, último owner protegido, sem autoelevação | TESTADO | 84 testes pgTAP, com e sem seed |
| Privilégios por coluna (D-012) | TESTADO | pgTAP: não move site entre tenants, não forja created_by |
| Auditoria append-only (UPDATE/DELETE/TRUNCATE bloqueados) | TESTADO | pgTAP |
| Matriz RBAC no código = banco | TESTADO | `pnpm rbac:drift` (33 permissões) |
| Domínio RBAC (`can`, `canInAnyScope`, `canManageRole`) | TESTADO | 19 testes Vitest |
| Web: login, seletor de organização, Locais/Membros/Auditoria somente leitura | TESTADO | 8 testes Vitest + 10 E2E Playwright (UI e API) |
| Sem segredo/service_role no bundle | TESTADO | `scripts/check-bundle-secrets.mjs` |
| Falsificação: policy permissiva injetada de propósito | VALIDADO | a suíte pgTAP falhou 8 testes; banco restaurado por reset |
| CI (`.github/workflows/ci.yml`) | NÃO TESTADO | nunca executado (sem remote git); actions fixadas por tag major, não verificadas |

## Limites / pendências conhecidas
- Sem fluxo de convite por e-mail nem CRUD de sites/membros na UI (Fase 2). Telas atuais são somente leitura.
- MFA ainda não exigido (D-016). Rate limit de login do Auth local = 30/5 min (pode afetar E2E em execuções repetidas).
- Hash encadeado dos eventos: Fase 3 (audit_log atual é append-only por trigger; superusuário do banco pode desabilitar triggers).
- Uma falha intermitente de E2E ocorreu 1x na primeira execução (causa não confirmada: Vite frio ou rate limit); 4 execuções seguintes limpas. Um `pnpm build` falhou 1x sem causa identificada e passou ao repetir.
- Desempenho da checagem `has_permission` por linha: NÃO medido.
- Lacunas regulatórias herdadas da Fase 0 (Lei 14.967, Guia ANPD Biometria, NR-23) seguem abertas; não bloqueiam a Fase 2.
- Segurança: checkpoint formal (Security Audit/Adversarial Verify via skills) ainda não rodado; feita revisão manual adversarial da migration (ver D-012).

## Decisões do dono ainda abertas
D-005 (Edge em Node+SQLite), D-009 (Node 24 LTS), remote git do projeto, aprovação da Fase 1.

## Próximo
Fase 2: sites, zonas, pessoas, grupos, credenciais, pontos de acesso, horários e políticas (CRUD com RLS testada).
- Regra permanente: Zela Escola (`Projeto_Zela`) protegido.
