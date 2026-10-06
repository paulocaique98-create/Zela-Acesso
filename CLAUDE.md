# ZELA ACESSO — CONTEXTO PERMANENTE

Arx Tecnologia · SaaS multi-tenant de controle de acesso físico. Produto de produção, não protótipo.

## Hierarquia
1. Instrução atual do usuário. 2. Este arquivo. 3. `docs/ZELA_ACESSO_STATUS.md`. 4. Docs específicos. 5. `PROMPT_MESTRE_ZELA_ACESSO_CLAUDE_CODE.md` só quando a tarefa exigir (buscar a seção, não reler inteiro).

## Fluxo
ENTENDER → LOCALIZAR → LER TRECHO → SEGURANÇA → PLANEJAR → EDITAR → TESTAR → STATUS. Não inventar estado; não declarar teste, conformidade ou segurança sem evidência.

## Economia de contexto
Grep/Glob antes de Read; trechos de 80–150 linhas; não reler arquivo já analisado; SQL com colunas explícitas (nunca `select *`); testar alvo específico antes da suíte; editar pontualmente.

## Ambiente (REGRAS DE PROTEÇÃO)
- Git deste projeto é o desta pasta. O git da home (`C:/Users/User`, remote Painel-SDR) NÃO é do projeto.
- Zela Escola (`Projeto_Zela`) é protegido: nunca `supabase stop`, `docker compose down`, `docker system prune`, remoção de volumes/containers dele. Antes de comando Docker/Supabase destrutivo: identificar alvo e confirmar que é `zela-acesso-local`.
- Supabase local: `project_id = "zela-acesso-local"`, portas 55xxx. Nunca `link`, `db push`, `functions deploy`, `secrets set` ou `db reset --linked` em desenvolvimento. Nunca copiar `.env`/chaves do Zela Escola.

## Stack
React 19 + Vite 8 + Tailwind v4, **JavaScript/JSX sem TypeScript** (tipos documentados com JSDoc nos contratos de domínio); Supabase (Postgres, Auth, Storage, Realtime, Edge Functions/Deno) com RLS; Edge Agent local segue em Node (D-005); pnpm monorepo; Vitest; Playwright; lint/format/CI. Sem `tsc`: a segurança de tipos vem de testes, RLS e do check `rbac:drift`. Fixar versões só após verificar compatibilidade.

## Regras de domínio
- Multi-tenant: `tenant_id` + RLS em tudo; nunca confiar no frontend; nunca `service_role` no frontend; Storage privado; testar cross-tenant; nunca "resolver" erro com policy permissiva.
- RBAC por recurso + ação + escopo (site/zona); least privilege. Papéis: platform_owner, platform_support, organization_owner, organization_admin, security_manager, receptionist, hr_manager, auditor, installer, viewer.
- Motor: `evaluateAccess(context) -> AccessDecision` (ALLOW, DENY, CHALLENGE, DEGRADED_ALLOW, DEGRADED_DENY) com códigos de motivo estáveis. Determinístico; **nunca IA generativa decidindo abrir porta**.
- Access Evidence: explica cada decisão relevante. Eventos append-only; correção = novo evento preservando o original.
- Credenciais: PIN nunca em texto puro; tokens temporários com alta entropia, expiração e revogação; múltiplas credenciais por pessoa.
- Biometria: **não usar `face-api.js`**; via `BiometricProvider`; `@vladmandic/human` é candidato sujeito a benchmark; liveness só se realmente suportado; biometria desligada por padrão; dado sensível (LGPD).
- Edge/offline: nuvem não é requisito absoluto; fila persistente, idempotência, retry/backoff, heartbeat; nenhum comando local de abertura sem autenticação.
- Hardware: domínio → abstração → driver → protocolo/SDK → dispositivo; sem protocolo inventado; mocks só em dev/teste; um caminho real antes do release operacional.
- Emergência: software nunca bloqueia saída segura; fail-safe/secure configurável por ponto.
- Limites: acesso físico ≠ ponto; sem REP/AFD, folha, vigilância/monitoramento profissional no MVP.
- Regulatório: consultar fonte oficial atual; classificar (lei/regulamento/norma/boa prática/validação jurídica); nunca "conforme a norma" sem evidência. Estado em `docs/07-REGULATORY-MATRIX.md`.
- Logs: nunca PIN, tokens, secrets ou biometria bruta.

## Prioridades
Segurança → integridade → isolamento → correção → confiabilidade → não regressão → escalabilidade → performance → custo → tokens.

## Pronto =
implementação + segurança + testes executados + tratamento de erro + auditoria + documentação + isolamento tenant. Distinguir sempre: IMPLEMENTADO / TESTADO / VALIDADO / NÃO TESTADO / PENDENTE / HIPÓTESE.

## Resposta
RESUMO · ALTERAÇÕES · VALIDAÇÃO · RESULTADO · PENDÊNCIAS. Ao concluir tarefa, lembrar `/clear`.
