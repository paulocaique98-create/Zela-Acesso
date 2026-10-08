# 11 — API

Estado: **superfície interna da Fase 3** (RPCs Postgres e funções de domínio). Ainda não há API HTTP pública, `packages/contracts` versionado, webhooks nem OpenAPI — nascem com o Edge/integrações (Fase 4+). Este documento só afirma o que existe e está testado localmente.

## 1. Princípios

- O frontend usa Supabase com a chave pública + RLS. **`service_role` nunca vai ao frontend**; as RPCs de gravação do motor são exclusivas dele (backend/Edge).
- Tenant sempre derivado da sessão/permissão no banco; RPC `security definer` com `search_path = ''` e checagem explícita de permissão no escopo (tenant + site).
- Erros: `42501` sem permissão, `P0002` não encontrado (também para recurso de outro tenant/escopo, sem vazar existência), `22023` argumento inválido.
- Logs e respostas nunca carregam PIN, token, secret ou biometria.

## 2. Funções de domínio (`packages/domain`)

| Função | Papel |
|---|---|
| `evaluateAccess(ctx) → AccessDecision` | Motor determinístico; falha fechada (`CONTEXT_INVALID`). Contrato em `access-contracts.js` |
| `evaluateAntiPassback(input)` / `presenceToCommit(r)` | Regra pura de anti-passback e do que gravar |
| `toAccessEventParams(input)` | Converte decisão em argumentos de `record_access_event` (allowlist de evidência) |
| `isAccessReasonCode`, `isAccessDecisionKind`, `OPENING_DECISIONS` | Validação dos códigos estáveis (ver `10-ACCESS-EVIDENCE.md`) |

## 3. RPCs da Fase 3

| RPC | Quem chama | Permissão | Efeito |
|---|---|---|---|
| `record_access_event(p_tenant, p_site, p_event_type, p_occurred_at, p_decision, p_reason_code, p_person, p_credential, p_access_point, p_zone, p_policy, p_physical_outcome, p_source, p_correlation, p_evidence, p_idempotency_key)` → `uuid` | `service_role` | — | Grava evento na cadeia; idempotente por `(tenant, idempotency_key)`; recusa `correction` |
| `record_access_correction(p_event_id, p_reason, p_corrected)` → `uuid` | `authenticated` | `access_event:correct` (+ `read`) no site | Novo evento `correction` + `audit_log`; justificativa ≥ 5 caracteres |
| `verify_access_chain(p_tenant)` → `(ok, checked, first_broken_seq)` | `authenticated`, `service_role` | `audit:read` ou `service_role` | Recalcula hashes, encadeamento e sequência |
| `get_antipassback_context(p_tenant, p_access_point, p_person)` | `service_role` | — | Insumos crus (zona, sentido, modo, reset, estado, desde); sem linha → `unknown` |
| `commit_presence(p_tenant, p_zone, p_person, p_state, p_at, p_event)` → `boolean` | `service_role` | — | Grava presença; evento mais antigo que o estado atual é ignorado (retorna `false`) |
| `reset_presence(p_zone, p_person, p_reason)` → `integer` | `authenticated` | `presence:reset` (+ `read`) no site | Volta presença a `unknown` (pessoa ou zona inteira); justificativa obrigatória; auditado |

### Leitura (RLS, sem RPC)

- `access_events`: `select` por `access_event:read` com escopo de site. Sem `insert/update/delete` para `authenticated`.
- `presence_states`: `select` por `presence:read`. Sem escrita direta.

## 4. Permissões novas (matriz 152 → 159, `rbac:drift` ok)

`access_event:read` (owner, admin, security_manager, auditor), `access_event:correct` (owner, admin, security_manager), `presence:read` (owner, admin, security_manager, auditor), `presence:reset` (owner, admin, security_manager).

## 5. Fluxo previsto do vertical slice (Fase 4, ainda não implementado)

1. Edge/backend monta `AccessContext` (credencial, pessoa, políticas, janelas, `get_antipassback_context` → `evaluateAntiPassback`).
2. `evaluateAccess` decide.
3. `record_access_event` (com `idempotency_key`) grava a evidência; se a porta liberar, `commit_presence` conforme `presenceToCommit`.
4. Resultado físico chega como evento `physical_outcome` com o mesmo `correlation_id`.

## 6. Gateway do Edge Agent (Fase 4C)

`POST /functions/v1/edge-gateway` (`verify_jwt = false`). Autenticação: `x-agent-id` (uuid) + `x-agent-secret` (`zes_` + 64 hex); a Edge Function repassa às RPCs `edge_*` (só `service_role`), que autenticam de novo. Corpo JSON `{ "op": ... }`:

| op | Corpo | RPC | Resposta |
|---|---|---|---|
| `heartbeat` | `version`, `agentTime` (ISO), `queueDepth` | `edge_heartbeat` | `{ serverTime, clockDriftSeconds }` |
| `snapshot` | `knownHash` (64 hex ou nulo) | `edge_pull_snapshot` | `{ unchanged, hash, serverTime, snapshot? }` |
| `events` | `events` (1–100, payload de `toAccessEventParams`) | `edge_ingest_events` | `{ serverTime, results: [{ idempotencyKey, status, reason? }] }`, status = recorded, duplicate ou rejected |

Status: `401` credencial inválida/revogada (genérico), `400` corpo inválido, `405`, `413` (>512 KB), `429` (rate limit), `502` erro do banco (sem detalhe). Regras de ingestão em `09-OFFLINE-FIRST.md` §6.

### Gateway: `reader_enrolled` (Zela Pass, D-027)

Mesma autenticação do agente. Corpo `{ op:'reader_enrolled', readerId, publicKey (64 hex), label? }` → RPC `edge_report_reader_enrolled` → `{ recorded: boolean }` (`false` = leitor inexistente/outro tenant/já ativo/revogado; a RPC não distingue). O snapshot (`snapshot`) passou a trazer `accessPoints[].actuation`, `readers[]` e `people[].refHash`.

## 6b. Protocolo do leitor Zela Pass (Edge ↔ tablet/app)

Definido em `packages/domain/src/reader.js`; implementado em `apps/edge-agent/src/reader-service.js`. Envelope `{ v:1, type, readerId, ts, nonce, body (texto JSON), sig }`, Ed25519 sobre `zela-reader/v1
<type>
<readerId>
<ts>
<nonce>
<sha256(body)>`. Tipos: `enroll` (código `zrd_`+64 hex e chave pública; `readerId` fixo `enroll`), `status`, `attempt` (`method` pin|qr|barcode + `deviceEventId`). Transportes: `POST /reader/v1/message` (HTTPS), `GET /reader/v1/ws` (WebSocket, uma resposta por mensagem), TCP NDJSON. Resposta `{ ok, code, serverTime, ... }`; `attempt` ok traz `outcome` (REGISTERED | NOT_AUTHORIZED | INVALID_CREDENTIAL | CHALLENGE_REQUIRED) e `label`. Códigos de erro: MALFORMED(400), UNSUPPORTED_VERSION(400), UNAUTHORIZED(401), CLOCK_SKEW(401), REPLAY(401), REVOKED(403), ENROLL_REJECTED(403), POINT_UNAVAILABLE(409), RATE_LIMITED(429), NO_SNAPSHOT(503). RPCs do painel: `create_access_reader(p_point, p_name)`, `revoke_access_reader(p_reader, p_reason)`.

## 7. Pendências

- Contratos versionados (`packages/contracts`), assinatura de webhooks e OpenAPI: Fases 4+. O gateway do agente não tem versionamento de protocolo ainda.
- Sem política de versionamento/depreciação de RPC definida ainda.
- Demais RPCs existentes (`create_tenant`, `issue_credential`, `platform_*`, `my_plan`, `log_error`) pertencem às Fases 1–2 e não estão detalhadas aqui.
