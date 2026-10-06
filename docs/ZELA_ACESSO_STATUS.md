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

## Fase 2 — em andamento (iniciada em 2026-10-06)
Fatiada. **2A (zonas, pessoas, grupos, membros de grupo): banco IMPLEMENTADO e TESTADO** — migration `20261007120000_phase2a_zones_people_groups.sql`; pgTAP 145/145 (84 da Fase 1 + 61 novos: cross-tenant, FK composta, escopo por site, matriz por papel, privilégios por coluna, auditoria sem nome/external_ref); Vitest 21+8; lint/format limpos; `rbac:drift` 84 permissões idênticas. Matriz RBAC 33 → 84.
- **2A PENDENTE**: telas/CRUD na UI (Zonas, Pessoas, Grupos) e E2E; E2E e build não reexecutados nesta fatia.
- **2B–2D PENDENTE**: credenciais (hash, nunca texto puro), pontos de acesso, horários/feriados, políticas.
- Decisão tomada sem o dono: pessoa é nível tenant (exige escopo tenant-inteiro); `kind` sem `visitor` (visitantes = Fase 5); delete de grupo só owner/admin.
- Observação: `db:reset` falhou 1x por healthcheck do Storage (transitório; migrations aplicaram e containers ficaram saudáveis).

## Infra e layout (2026-10-06)
- Supabase remoto `hgdbtuhbcidtmxcnaxhv` (staging, sa-east-1): 2 migrations aplicadas (84 permissões, 30 policies, 0 tabelas sem RLS); banco vazio (sem usuários/tenants). pgTAP/drift NÃO rodados no remoto.
- GitHub `paulocaique98-create/Zela-Acesso` (HTTPS; sem chave SSH). CI passou no push da 2A.
- Vercel: projeto mantido `zela-acesso.` (Root `apps/web`, `apps/web/vercel.json`, prod https://zela-acesso-tawny.vercel.app). Variáveis `VITE_SUPABASE_*` nos 3 ambientes; integração Supabase da Vercel aponta ao projeto do Zela Acesso (verificado), mas injetou chaves de admin não usadas (remoção pendente de aval). Projeto duplicado `zela-acesso` (deploy em ERROR) ainda existe.
- Layout do Zela (tema, Inter, lucide, sidebar retrátil, header, login) aplicado ao web. Referência: repo Zela-app (leitura apenas). Porta de dev do web: 55173.
- E2E: 10/10 em 6 de 7 execuções após o layout; 1 falha intermitente (login preso em "Carregando" >5 s, 1ª execução com Vite frio). Antes do layout: 4/4. Mitigado com `optimizeDeps.include`; causa não confirmada.
- PENDENTE: Auth no painel Supabase (signup público, SMTP, Site URL/Redirect URLs com a URL da Vercel e http://127.0.0.1:55173), bootstrap do primeiro platform_owner/tenant.

## Painel do Desenvolvedor (2026-10-06) — paridade com o portal do Dev do Zela Escola
Referência (leitura apenas): Zela-app `DeveloperLayout/Panel/Modulos/Planos/PlanosContratacao/ChatSupport/ErrorLogs/QualidadeBiometria` + `ConfiguracoesPanel`. Tema CLARO (decisão do dono); menus: Gestão de Organizações, Planos, Faturamento (em breve), Logs, Biometria, Suporte, Configurações.
- **IMPLEMENTADO e TESTADO local** — migrations `20261008120000_platform_portal.sql` e `20261009120000_platform_dev_panel.sql`: `org_code` ZA###, `features_enabled`/`limits`, `tenant_details` (CNPJ, endereço, notas internas só da plataforma), histórico de módulos por trigger, catálogo de preços/planos/ciclos/contratações com recálculo no servidor (`platform_contract_plan`), `my_plan`, suporte (threads/mensagens com Realtime e limite de envio), `error_logs` + `log_error` (dedupe, sem chaves sensíveis, URL sem query), `system_settings` (logo/imagem de login, só imagem PNG/JPG/WebP ou https), `user_security_flags` (troca de senha obrigatória). RBAC 84 → 88 (`support:read/write` para owner/admin).
- **Testes executados**: pgTAP 4 suítes / 276 asserts PASS; Vitest domínio 62 + web 23; lint/format/build/check:bundle limpos; `rbac:drift` 88 idênticas; E2E 28/28 na última execução (1ª execução anterior teve 1 falha de login preso em "Carregando", intermitente já conhecida).
- **Edge Function `create-tenant-owner`** (cria conta + organização; troca de senha obrigatória no 1º login): lógica TESTADA com clientes simulados (21 casos). **NÃO TESTADA de ponta a ponta** (edge-runtime desligado no Supabase local) e **NÃO publicada**. O E2E dessa rota usa rede simulada.
- Diferenças deliberadas em relação ao Escola: sem "Excluir" definitivo (só suspender/reativar; decisão do dono); sem "Explicar com IA" nos logs (envia logs a terceiro e exige segredo; dono decidiu: não precisa agora); sem busca de CEP externa; senha do responsável ≥ 12 caracteres e gerador de senha; mensagens do banco nunca exibidas cruas.
- **Dados comerciais são placeholders**: todos os preços do catálogo nascem 0 e não há planos; a Arx define a tabela no menu Planos. O catálogo de módulos (`packages/domain/src/modules.js`) foi conferido e APROVADO pelo dono (base, pontos de acesso e credenciais, horários/políticas, visitantes, relatórios, agente local, biometria). platform_support lê logs, chat e cadastro das organizações, sem preços/contratos (confirmado pelo dono). Limites contratados são só registro (não aplicados automaticamente). Módulos marcados "em construção" não têm tela que dependa da chave.
- Biometria (menu): só mostra quantas organizações ligaram a chave; o módulo não existe ainda. Faturamento: desabilitado ("Em breve").
- Local: `[auth.rate_limit] sign_in_sign_ups = 300` no `config.toml` (só local) para a suíte E2E. Usuário `responsavel.teste@example.test` no seed (dono das organizações criadas pelos testes).
- **PENDENTE no remoto (staging)**: aplicar migrations 3 e 4 (`db push`, depende de autorização), publicar a função e definir `ALLOWED_ORIGINS`, e só então publicar o front (senão o painel em produção consulta colunas inexistentes). Criar o `platform_owner` local após `db:reset`: `node scripts/create-platform-admin.mjs` (senha por variável de ambiente).

## Mudança de stack (2026-10-06, pós-aprovação da Fase 1)
Código convertido de TypeScript para JS/JSX (D-017). Reexecutado depois da conversão: lint, format:check, Vitest (19 + 8), build, check:bundle, rbac:drift (33) e E2E (10/10). pgTAP não foi reexecutado (banco inalterado). Risco novo: sem checagem estática de tipos. Edge Functions ainda não existem (Deno quando surgirem).

## Limites / pendências conhecidas
- Sem fluxo de convite por e-mail nem CRUD de sites/membros na UI (Fase 2). Telas atuais são somente leitura.
- MFA ainda não exigido (D-016). Rate limit de login do Auth local subido para 300/5 min (só local) por causa do E2E; o remoto mantém o padrão.
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
