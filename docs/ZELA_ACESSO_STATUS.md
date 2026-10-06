# Status — Zela Acesso
Atualizado: 2026-10-06

- **Fase 0**: aprovada pelo dono em 2026-10-06 (docs 01–04, 07, 14, 15, 19, 20, CLAUDE.md).
- **Fase 1** (fundação): **implementada e testada localmente; gate cumprido; aguardando aprovação do dono**.
- Skills de projeto instaladas: skill-security-scan, adversarial-verify, context-warden. Dispensadas pelo dono: supabase, postgres-best-practices, playwright-skill, security-audit (D-011).

## Entregue na Fase 1 (evidência: executado em 2026-10-06, máquina local)
| Item | Estado | Evidência |
|---|---|---|
| Monorepo pnpm (apps/web, packages/domain), JS/JSX (D-017), ESLint, Prettier | TESTADO | `pnpm lint` e `format:check` limpos; reexecutado após converter de TS para JS |
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

## Mudança de stack (2026-10-06, pós-aprovação da Fase 1)
Código convertido de TypeScript para JS/JSX (D-017). Reexecutado depois da conversão: lint, format:check, Vitest (19 + 8), build, check:bundle, rbac:drift (33) e E2E (10/10). pgTAP não foi reexecutado (banco inalterado). Risco novo: sem checagem estática de tipos. Edge Functions ainda não existem (Deno quando surgirem).

## Limites / pendências conhecidas
- Sem fluxo de convite por e-mail nem CRUD de sites/membros na UI (Fase 2). Telas atuais são somente leitura.
- MFA ainda não exigido (D-016). Rate limit de login do Auth local = 30/5 min (pode afetar E2E em execuções repetidas).
- Hash encadeado dos eventos: Fase 3 (audit_log atual é append-only por trigger; superusuário do banco pode desabilitar triggers).
- Uma falha intermitente de E2E ocorreu 1x na primeira execução (causa não confirmada: Vite frio ou rate limit); 4 execuções seguintes limpas. Um `pnpm build` falhou 1x sem causa identificada e passou ao repetir.
- Desempenho da checagem `has_permission` por linha: NÃO medido.
- Lacunas regulatórias herdadas da Fase 0 (Lei 14.967, Guia ANPD Biometria, NR-23) seguem abertas; não bloqueiam a Fase 2.
- Sem `tsc` (D-017): sem checagem estática de tipos; compensar com testes, RLS e `rbac:drift`. Avaliar `// @ts-check` ou lint de JSDoc só se o dono pedir.
- E2E exige `PLAYWRIGHT_BROWSERS_PATH=./.playwright-browsers` (senão procura o Chromium na pasta global e falha). Documentar no README/LOCAL_ENV.
- Servidor Vite com cache antigo quebra a página após mudar `main` de pacote: reiniciar o `pnpm dev`.
- Estrutura: monorepo mantido (apps/web, packages/domain). Dono pode pedir estrutura achatada (raiz única) como no Zela Escola.
- pgTAP não reexecutado após a conversão para JS (banco inalterado).
- Push bloqueado: sem remote git (pendente de decisão do dono).
- Segurança: checkpoint formal (Security Audit/Adversarial Verify via skills) ainda não rodado; feita revisão manual adversarial da migration (ver D-012).

- Fase 2 (antes ou junto): MFA obrigatório para admins/owners deve ser decidido antes do piloto (D-016).
- Docs da Fase 0 ainda não criados: 00, 05, 06, 08–13, 16–18, CONTRIBUTING, SECURITY.md.
- Skills de agentes (skill-security-scan, adversarial-verify, context-warden) só aparecem em nova sessão do Claude Code.
- CI: ao existir remote git, executar o workflow, verificar as actions e registrar o resultado.

## Decisões do dono ainda abertas
- Aprovação da Fase 1 (pré-requisito para iniciar a Fase 2).
- D-005 (Edge em Node+SQLite).
- D-009 (Node 24 como LTS).
- Remote git do projeto (habilita rodar o CI).

## Próximo
Fase 2: sites, zonas, pessoas, grupos, credenciais, pontos de acesso, horários e políticas (CRUD com RLS testada).
- Regra permanente: Zela Escola (`Projeto_Zela`) protegido.
