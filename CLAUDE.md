# ZELA ACESSO — CONTEXTO PERMANENTE

Arx Tecnologia · SaaS multi-tenant de controle de acesso físico. Produto de produção, não protótipo.

Este arquivo é só memória operacional e economia de tokens. O documento base do projeto é `PROMPT_MESTRE_ZELA_ACESSO_CLAUDE_CODE.md` (requisitos, regras, fases); em conflito de regra de produto, vale ele.

## Hierarquia
1. Instrução atual do usuário. 2. `PROMPT_MESTRE_ZELA_ACESSO_CLAUDE_CODE.md` (documento base; buscar a seção com Grep, nunca reler inteiro). 3. `docs/ZELA_ACESSO_STATUS.md` (estado vivo). 4. Docs específicos (`docs/19-DECISIONS.md`, `07-REGULATORY-MATRIX.md`, etc.). 5. Este arquivo.

## Fluxo
ENTENDER → LOCALIZAR → LER TRECHO → SEGURANÇA → PLANEJAR → EDITAR → TESTAR → STATUS. Não inventar estado; não declarar teste, conformidade ou segurança sem evidência.

## Economia de contexto
Grep/Glob antes de Read; trechos de 80–150 linhas; não reler arquivo já analisado; SQL com colunas explícitas (nunca `select *`); testar alvo específico antes da suíte; editar pontualmente.

## Ambiente (REGRAS DE PROTEÇÃO)
- Git deste projeto é o desta pasta. O git da home (`C:/Users/User`, remote Painel-SDR) NÃO é do projeto.
- Zela Escola (`Projeto_Zela`) é protegido: nunca `supabase stop`, `docker compose down`, `docker system prune`, remoção de volumes/containers dele. Antes de comando Docker/Supabase destrutivo: identificar alvo e confirmar que é `zela-acesso-local`.
- Supabase local: `project_id = "zela-acesso-local"`, portas 55xxx. Nunca `link`, `db push`, `functions deploy`, `secrets set` ou `db reset --linked` em desenvolvimento. Nunca copiar `.env`/chaves do Zela Escola.

## Docker Desktop (quando ligar / desligar)
- **Ligar** (esperar "Engine running", depois `supabase start` na pasta do projeto) para: testes pgTAP/RLS/cross-tenant, aplicar/criar migrations locais, subir o app com dados reais, Playwright/E2E, `rbac:drift` se consultar o banco.
- **Pode ficar desligado** para: editar `packages/domain`, Vitest unitário, documentação, revisão de código, planejamento.
- **Desligar**: `supabase stop` na pasta do Zela Acesso, depois fechar o Docker Desktop. Nunca `docker compose down`/`prune`/remover volumes (compartilha o Docker com o Zela Escola).
- Erro de conexão em tarefa de banco = Docker desligado ou `supabase start` não executado. Ao iniciar tarefa que exige banco com Docker off, avisar o usuário em vez de contornar.

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
Ao concluir uma sessão, enviar sempre, nesta ordem: RESUMO · ALTERAÇÕES · VALIDAÇÃO · PENDÊNCIAS · RECOMENDAÇÕES PARA AGORA (próximos passos sugeridos, com o que fazer primeiro). Ao concluir tarefa, lembrar `/clear`.
