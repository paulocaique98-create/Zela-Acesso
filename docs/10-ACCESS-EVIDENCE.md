# 10 — Access Evidence

Estado: Fase 3 (3B–3D) implementada e testada **localmente**; não aplicada no remoto. Nenhum fluxo de produção grava eventos ainda (Edge = Fase 4).

## 1. O que é

Cada decisão de acesso relevante gera um **evento append-only** que explica *quem, onde, quando, o que foi decidido e por quê*. O motor (`evaluateAccess`, `packages/domain/src/access-engine.js`) é determinístico, puro (sem I/O, sem relógio, sem IA) e **falha fechada**: contexto inválido ou erro interno → `DENY / CONTEXT_INVALID`.

## 2. Decisões e códigos de motivo

Decisões: `ALLOW`, `DENY`, `CHALLENGE`, `DEGRADED_ALLOW`, `DEGRADED_DENY`. Abrem a porta: `ALLOW` e `DEGRADED_ALLOW`.

Códigos de motivo (contrato estável: **nunca renomear nem reutilizar, só acrescentar**; o teste `access-event.test.js` trava a lista JS contra o CHECK do SQL):

`POLICY_MATCH`, `POLICY_DENY`, `ZONE_NOT_ALLOWED`, `OUTSIDE_SCHEDULE`, `MULTI_FACTOR_REQUIRED`, `CREDENTIAL_INVALID`, `CREDENTIAL_EXPIRED`, `PERSON_DISABLED`, `VISITOR_EXPIRED`, `VISITOR_ZONE_NOT_ALLOWED`, `ANTI_PASSBACK`, `EMERGENCY_POLICY`, `DEVICE_UNTRUSTED`, `ACCESS_POINT_INACTIVE`, `OFFLINE_POLICY_DENY`, `OFFLINE_POLICY_ALLOW`, `CONTEXT_INVALID`.

### Precedência (a primeira que decide vence)

1. Emergência (`fail_safe` libera; `fail_secure` mantém travado — software nunca bloqueia saída segura por conta própria).
2. Ponto inativo / dispositivo não confiável.
3. Credencial (status, expiração, vínculo com a pessoa).
4. Pessoa ativa.
5. Visita (estado e zona permitida).
6. Políticas + janelas de acesso (padrão é negar; janela desconhecida nega).
7. Desafio (segundo fator) já satisfeito pelo chamador.
8. Anti-passback (só interfere em quem seria liberado).
9. Modo offline (`offlineBehavior` do ponto).

## 3. Estrutura da evidência

`AccessDecision.evidence`: `personId`, `credentialId`, `accessPointId`, `zoneId`, `policyId`, `scheduleId`, `deviceTrusted`, `antiPassback` (`OFF|OK|VIOLATION_SOFT|VIOLATION_HARD`), `offline`, `evaluatedAt`, `steps[]` (trilha das etapas, ex.: `policy:DENY:...`, `DENY:OUTSIDE_SCHEDULE`).

Ao gravar (`toAccessEventParams`, `access-event.js`) só uma **allowlist** vai para `evidence`: `scheduleId`, `deviceTrusted`, `antiPassback`, `offline`, `evaluatedAt`, `steps` (máx. 50). O contexto cru e as credenciais nunca são repassados. No banco, um CHECK rejeita chaves sensíveis (pin/token/secret/biometria) e limita a evidência a 16 KB.

## 4. Tabela `access_events`

| Item | Regra |
|---|---|
| Tipos | `access_decision`, `physical_outcome`, `correction` |
| Origem (`source`) | `ENGINE`, `EDGE_AGENT`, `DEVICE`, `ADMIN` |
| Resultado físico | `DOOR_OPENED`, `DOOR_NOT_OPENED`, `DOOR_FORCED`, `DOOR_HELD_OPEN`, `UNKNOWN` (evento próprio; ligação ao evento de decisão só por `correlation_id`) |
| Append-only | trigger bloqueia UPDATE/DELETE/TRUNCATE + privilégios revogados (vale para `service_role`) |
| Idempotência | `(tenant_id, idempotency_key)`; repetir devolve o mesmo evento |
| Isolamento | `tenant_id` + FK composta de site; RLS de leitura por `access_event:read` com escopo de site |
| Gravação | `record_access_event` — **somente `service_role`** |

### Cadeia de hash

SHA-256 **por tenant**. `seq`, `prev_hash`, `recorded_at`, `hash_version` e `hash` são calculados por trigger sob advisory lock; valores enviados pelo chamador são descartados. O hash cobre os campos do evento (incluindo evidência, correlação, chave de idempotência e dados de correção) encadeados ao hash anterior. `verify_access_chain(tenant)` recalcula tudo e devolve `(ok, checked, first_broken_seq)`; exige `audit:read` ou `service_role`.

**Limite declarado:** o hash é **integridade técnica, sem valor jurídico declarado**. Sem assinatura nem âncora externa, um superusuário que reescreva coordenadamente todo o final da cadeia não é detectado. Âncora externa/assinatura = pendência (ver §6).

### Correção

Eventos nunca são alterados. `record_access_correction(event_id, reason, corrected)` cria um novo evento `correction` (`corrects_event_id`, justificativa ≥ 5 caracteres, `actor_user_id`, hash do original em `evidence`) e registra no `audit_log` (`access_event.correct`). Exige `access_event:correct` no escopo do site.

## 5. Anti-passback

- Modo por **zona**: `zones.antipassback_mode` (`off` padrão, `soft`, `hard`) e `antipassback_reset_minutes` (1–10080).
- O sentido vem de `access_points.direction`. Ponto bidirecional não verifica nem grava.
- Estado em `presence_states` (por tenant + zona + pessoa; RLS `presence:read`; sem escrita direta).
- `evaluateAntiPassback` (puro): `unknown` nunca viola; reset automático por tempo; `soft` libera e registra `VIOLATION_SOFT`; `hard` nega com `ANTI_PASSBACK` e não grava presença (`presenceToCommit`).
- `get_antipassback_context` e `commit_presence`: só `service_role`. Evento mais antigo que o estado atual **não regride** a presença (replay offline fora de ordem).
- `reset_presence(zone, person|null, reason)`: permissão `presence:reset`, justificativa obrigatória, auditado; estado volta a `unknown`.

## 6. Pendências e limites conhecidos

- Nada chama `record_access_event`, `get_antipassback_context` nem `commit_presence` ainda (liga no vertical slice / Edge, Fase 4).
- Sem tela de consulta de eventos nem de edição do modo de anti-passback.
- Sem partição/retenção (decisão LGPD antes de dados reais); sem assinatura/âncora externa da cadeia.
- Sem vínculo formal entre `physical_outcome` e o evento de decisão (apenas `correlation_id`).
- **Resultado físico do Edge (Fase 4D)**: depois de acionar o driver, o agente enfileira um evento `physical_outcome` (source `EDGE_AGENT`, mesma `correlation_id` da decisão, sem `decision`/`reason_code`). `ok` => `DOOR_OPENED`; `TIMEOUT` => `UNKNOWN`; outra falha => `DOOR_NOT_OPENED`. A evidência leva só `{ actuation: { ok, code } }` (código do driver validado por padrão). A decisão original nunca é alterada. A ingestão (`edge_ingest_events`) aceita só `access_decision` e `physical_outcome`; `correction` segue vedado ao agente. Limite: o resultado vem do comando ao driver, não de sensor de porta (DOOR_FORCED / DOOR_HELD_OPEN dependem de driver real).
- Sem zona-par entrada/saída explícita nem exceção de anti-passback por pessoa.
- Offline com `degraded_deny`: qualquer decisão (inclusive `DENY` de política) vira `DEGRADED_DENY / OFFLINE_POLICY_DENY`, mascarando o motivo original no código; o motivo original continua em `evidence.steps`. Avaliar na Fase 4 se o código deve preservar o motivo da regra.
