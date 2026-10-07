# 09 — Offline-first / Edge Agent

Zela Acesso · Arx Tecnologia. Requisito obrigatório (Prompt Mestre §18–19): a internet do cliente pode cair e o controle de acesso já configurado não pode parar por isso, salvo quando a política do cliente determinar o contrário.

Legenda de estado: **IMPLEMENTADO** (código existe e testado em Vitest/pgTAP, conforme `docs/ZELA_ACESSO_STATUS.md`) · **PENDENTE** (fase futura) · **HIPÓTESE** (a validar). Este documento descreve o desenho; não substitui o status vivo.

## 1. Princípios

1. **A nuvem não é requisito absoluto.** A decisão de acesso do dia a dia ocorre no Edge, com o cache local.
2. **Mesmo motor, dois lugares.** O Edge chama o mesmo `evaluateAccess` de `packages/domain` usado na nuvem. Determinístico; nenhuma IA generativa decide abrir porta.
3. **Fail-safe configurável por ponto.** Cada ponto de acesso define `offlineBehavior` (`degraded_allow` ou `degraded_deny`) e `emergencyBehavior`. Software nunca bloqueia saída segura.
4. **Na dúvida sobre a validade do cache, negar.** Cache velho demais converte `degraded_allow` em `degraded_deny` (ver §5).
5. **Nada é perdido.** Todo evento relevante vai para uma fila persistente e é entregue com idempotência, mesmo após horas offline.
6. **Eventos são append-only.** O Edge nunca reescreve evento; correção = novo evento (ver `10-ACCESS-EVIDENCE.md`).
7. **Nenhum comando local de abertura sem autenticação.** Um simples request HTTP local não abre porta (Prompt Mestre §19).
8. **Sem segredos em claro.** PIN só como hash (bcrypt) no cache; tokens/cartões como hash SHA-256; logs nunca contêm PIN, token, secret ou biometria bruta.

## 2. Arquitetura

```text
CLOUD (Supabase: Postgres + RLS, Edge Functions)
  │  TLS
  ▼
EDGE AGENT  (apps/edge-agent · Node + SQLite embutido, D-005)
  ├── Cache de snapshot      (política, janelas, grupos, pessoas, credenciais-hash)
  ├── Decisão local          (evaluateAccess + anti-passback)
  ├── Fila de eventos        (persistente, idempotente, backoff)
  ├── Presença local         (anti-passback), contadores de falha de PIN
  ├── Heartbeat / saúde
  └── Drivers de dispositivo (Fase 4D)
        │
        ▼
CONTROLADORA / DISPOSITIVO
```

Cadeia de hardware: domínio → abstração → driver → protocolo/SDK → dispositivo (ver `08-HARDWARE-INTEGRATION.md`, a criar na Fase 4D).

## 3. Identidade e segurança do agente

| Item | Estado | Como |
|---|---|---|
| Cadastro do agente por site | IMPLEMENTADO (4A) | `create_edge_agent(p_site, p_name)`; token de enrollment de uso único |
| Enrollment | IMPLEMENTADO (4A) | `edge_enroll(p_token, hostname, version)` devolve o segredo do agente uma vez |
| Autenticação do agente | IMPLEMENTADO (4A) | `edge_authenticate(p_agent, p_secret)`; segredo guardado como SHA-256 na nuvem |
| Rotação de segredo | IMPLEMENTADO (4A) | `edge_rotate_secret`; o antigo deixa de valer na hora |
| Revogação | IMPLEMENTADO (4A) | `revoke_edge_agent(p_agent, p_reason)` |
| Acesso às funções `edge_*` | IMPLEMENTADO | `revoke ... from public, anon, authenticated`; `grant` só a `service_role`, usado **apenas** pela Edge Function (nunca pelo frontend nem pelo agente) |
| Transporte agente → nuvem (Edge Function, TLS) | IMPLEMENTADO (4C); TESTADO de ponta a ponta no edge-runtime LOCAL (agente real → gateway → RPCs → banco: heartbeat, snapshot, snapshot inalterado, eventos, duplicado, rejeitado, segredo errado e agente revogado = 401); NÃO publicado | `edge-gateway` (`verify_jwt = false`): cabeçalhos `x-agent-id` + `x-agent-secret`, ops `heartbeat`/`snapshot`/`events`, 401 genérico, limite de corpo (512 KB) e de lote (100), rate limit por agente (melhor esforço, por isolate). O agente (`transport.js`) exige https (loopback só em dev) e não guarda `service_role` |
| mTLS ou equivalente forte | HIPÓTESE | hoje: segredo por agente sobre TLS; decisão mTLS vs. segredo segue aberta (registrar em `19-DECISIONS.md`) |
| Armazenamento protegido do segredo no host | PENDENTE | cofre do SO ou arquivo com permissão restrita; definir em 4C/4E |
| Assinatura de comandos, proteção contra replay | PENDENTE (4D) | exigida antes de qualquer comando remoto de abertura |
| Circuit breaker, watchdog, logs com rotação, atualização segura, versão mínima | PENDENTE | 4C–4E; `edge_heartbeat` já devolve hora do servidor e deriva do relógio |

**Agente revogado**: a nuvem recusa a credencial (`edge_authenticate`/`edge_pull_snapshot` não retornam linha). O agente trata como `revoked` e **apaga o cache** (hashes de credenciais) — ver `syncSnapshot`. Eventos já na fila ficam para análise forense, não para reenvio.

## 4. Cache de política (snapshot)

**Fonte:** `edge_pull_snapshot(p_agent, p_secret, p_known_hash)` (4B), chamada pela Edge Function.

**Conteúdo (versão 1):** `tenantId`, `siteId`, `timezone`, `zones`, `accessPoints`, `policies`, `schedules` (janelas/feriados), `groupMembers`, `people`, `credentials`. Credenciais trafegam como hash: PIN com `secretHash` (bcrypt); cartão e token por hash SHA-256 — nunca o valor em claro.

**Regras de aplicação** (`apps/edge-agent/src/snapshot.js`, `sync.js`):

- Validação de formato antes de aplicar; qualquer desvio **rejeita** e mantém o cache anterior (`rejected`).
- Aplicação atômica em transação; o cache é uma linha única substituída inteira (sem estado parcial).
- **Vínculo único tenant/site:** o agente fica preso ao primeiro `tenantId/siteId` recebido. Snapshot de outro vínculo é rejeitado (defesa contra resposta trocada e erro de configuração).
- `p_known_hash`: se nada mudou, a nuvem responde `unchanged` e o agente apenas renova a "idade" do cache (`touchSnapshot`). `unchanged` sem hash correspondente é rejeitado.
- Resultado da sincronização: `updated | unchanged | revoked | offline | rejected`. `offline` (erro de transporte) **não** altera o cache.

## 5. Decisão offline

`processAccessAttempt` (`apps/edge-agent/src/decide.js`), numa única transação:

1. Resolve a credencial no cache (cartão, token móvel ou PIN). PIN com hash dummy para pessoa inexistente (sem oráculo de existência por tempo) e bloqueio local por falhas (padrão: 5 falhas → 5 min).
2. Avalia anti-passback com a presença local.
3. Chama `evaluateAccess` com `offline: true` (padrão: sem confirmação de nuvem acessível).
4. Registra o evento na fila e atualiza a presença **na mesma transação** (atômico).

**Cache defasado:** se a idade do cache excede `maxSnapshotAgeMs` (padrão **7 dias**, HIPÓTESE a calibrar por cliente) e o agente está offline, o ponto passa a `degraded_deny`, pois revogações podem não ter chegado. O passo `cache:stale` entra na evidência. Cache inexistente também nega.

| Situação | Comportamento |
|---|---|
| Nuvem ok, cache em dia | decisão normal (`ALLOW`/`DENY`/`CHALLENGE`) |
| Offline, cache em dia, ponto `degraded_allow` | `DEGRADED_ALLOW` se a política permitir |
| Offline, cache em dia, ponto `degraded_deny` | `DEGRADED_DENY` |
| Offline, cache defasado | `DEGRADED_DENY` (+ `cache:stale`) |
| Sem cache / ponto desconhecido | nega; evento só vai à fila se houver vínculo conhecido; id de ponto desconhecido **não** é propagado à nuvem |
| Emergência ativa | segue `emergencyBehavior` do ponto; saída segura nunca é bloqueada |

**Presença:** só avança quando a porta de fato libera. Anti-passback `soft` grava mesmo violando; `hard` não.

**Limite conhecido (aceito):** um cartão revogado na nuvem continua válido no Edge até o próximo sync bem-sucedido. Mitigações: sync frequente, teto de idade do cache, `degraded_deny` por ponto crítico. Deve constar no contrato com o cliente.

## 6. Fila persistente de eventos

SQLite com `journal_mode = wal` e `synchronous = full` (sobrevive a queda de energia). Tabela `event_queue`:

- `idempotency_key` **único**: reenfileirar a mesma chave é ignorado (`insert or ignore`).
- `attempts`, `next_attempt_at`, `last_error` (truncado a 200 caracteres), `sent_at`.
- **Backoff exponencial determinístico:** 2 s × 2^(n−1), teto de 15 min (`backoffMs`). O jitter fica por conta de quem agenda a drenagem (4C).
- `purgeSent` remove só eventos já entregues, após retenção definida.
- Evento não entregue nunca é apagado automaticamente.

**Entrega à nuvem (IMPLEMENTADA, 4C):** `drainQueue` (`drain.js`) envia em ordem de `id`, em lotes (50, até 10 lotes por rodada), ao gateway, que chama `edge_ingest_events` (só `service_role`). Backoff com jitter de até 20%. Resultado por evento: `recorded`/`duplicate` = entregue; `rejected` = rejeição definitiva (`rejected_at`: sai do envio, **nunca é apagado**, não entra em `purgeSent`); evento sem resultado volta com backoff; erro de transporte = `offline`; 401 = `revoked` (apaga cache, fila intacta). A nuvem deduplica pela chave de idempotência; reenvio após timeout é seguro.

**Regras de `edge_ingest_events` (testadas em pgTAP):** tenant e site vêm SEMPRE do agente autenticado (o que o payload declara é ignorado); `source` forçada para `EDGE_AGENT`; só `access_decision` (correção só por `record_access_correction`); `occurred_at` não pode estar mais de 5 min no futuro; ponto/zona/política de outro site e pessoa/credencial de outro tenant são descartados (viram `null`); `agentId` entra na evidência; evidência com chave sensível (pin, token…) é rejeitada pela constraint; um evento inválido não derruba o lote; lote máximo 100. A mensagem do banco nunca volta ao agente. Eventos chegam com `occurred_at` do agente e recebem `received_at` da nuvem; os dois são preservados.

## 7. Relógio

A decisão depende de hora (janelas, validade, anti-passback). O Edge usa o relógio do host, que pode derivar.

- **IMPLEMENTADO:** `edge_heartbeat` recebe `p_agent_time` e grava `last_clock_drift_seconds`; devolve a hora do servidor.
- **IMPLEMENTADO (4C):** `assessClock` (`clock.js`): `ok` até 60 s de deriva, `warn` até 300 s, `untrusted` acima disso, sem verificação ainda, ou sem contato com a nuvem há mais de 24 h. Limites são HIPÓTESE a calibrar por cliente. **Na decisão (`decide.js`):** relógio `untrusted` + offline → o ponto passa a `degraded_deny` (como cache defasado); `warn`/`untrusted` entram na evidência (`clock:warn`, `clock:untrusted`); com a nuvem acessível só registra. `config.enforceClock = false` desliga a negação. Efeito operacional a calibrar: agente sem contato com a nuvem por mais de 24 h nega tudo que depende de `degraded_allow` (HIPÓTESE).
- Eventos carregam a hora do agente e a deriva conhecida na evidência, para auditoria posterior.

## 8. Heartbeat e monitoramento

`edge_heartbeat(p_agent, p_secret, p_version, p_agent_time, p_queue_depth)` registra `last_seen_at`, versão, deriva e profundidade da fila. Sem linha retornada = credencial inválida/revogada: o agente deve parar de aceitar comandos e limpar o cache.

`sendHeartbeat` (`heartbeat.js`) envia versão, hora e profundidade da fila, guarda a deriva (`clock_drift_s`) e avalia o relógio; credencial recusada apaga o cache. O agendamento está em `runner.js` (`runOnce`/`runLoop`): heartbeat a cada 60 s, sync a cada 5 min, drenagem a cada 10 s (padrões, HIPÓTESE); heartbeat primeiro para atualizar a deriva; revogação em qualquer etapa encerra o laço; erro inesperado numa rodada não derruba o laço. Ainda não há executável/serviço do SO que o inicie (4E). Painel/alertas de agente sem heartbeat, fila crescente e deriva alta: PENDENTE (tela de saúde).

## 9. Conflitos e reconciliação

- **Eventos:** não há conflito de escrita; são imutáveis e idempotentes.
- **Presença (anti-passback):** o estado vive no Edge enquanto offline. Ao sincronizar, a nuvem recebe os eventos e pode reconciliar com `commit_presence`. Com mais de um agente por zona, a presença local pode divergir: **HIPÓTESE/PENDENTE**; no MVP, uma zona é atendida por um agente.
- **Política:** a nuvem é a fonte da verdade; o snapshot sempre substitui o cache inteiro. Não há edição de política no Edge.
- **Evento recebido com agente depois revogado:** DECIDIDO em 4C — a revogação anula a credencial na hora; **nada é aceito depois dela** (`edge_ingest_events` devolve `null` → 401). Eventos que estavam na fila ficam no host para análise forense, não para reenvio. Consequência: eventos ocorridos antes da revogação e ainda não entregues não chegam à nuvem; a revogação é para agente comprometido/descartado, e o impacto deve constar no procedimento operacional.

## 10. Comandos e dispositivos

IMPLEMENTADO em 4D (contrato HAL, Mock, comandos assinados): ver `08-HARDWARE-INTEGRATION.md`. Requisitos fixados:

- Comando só com autenticação, assinatura quando aplicável, idempotência e proteção contra replay.
- Driver mock apenas em dev/teste; antes do release operacional, um caminho real de hardware.
- Cada ponto define o comportamento de falha de energia/rede da fechadura (fail-safe ou fail-secure), documentado por ponto.

## 11. Testes

| Cobertura | Estado |
|---|---|
| Fila: idempotência, backoff, persistência, purga (`store.test.js`) | IMPLEMENTADO |
| Decisão offline, cache defasado, PIN, anti-passback (`decide.test.js`) | IMPLEMENTADO |
| Snapshot e vínculo tenant/site, sync `revoked/offline/rejected` | IMPLEMENTADO (Vitest) |
| Enrollment, autenticação, heartbeat, rotação, revogação, snapshot (pgTAP 12 e 13) | IMPLEMENTADO |
| Queda de rede real, reinício do host com fila cheia, falha de energia no meio da transação | PENDENTE (4C/4E, E2E) |
| Teste de carga da fila e do cache com site grande | PENDENTE |
| Deriva de relógio e reconciliação multi-agente | PENDENTE |

Ver `15-TEST-PLAN.md`.

## 12. Ameaças principais (resumo; detalhe em `14-THREAT-MODEL.md`)

| Ameaça | Mitigação |
|---|---|
| Agente clonado/comprometido | segredo único por agente, rotação, revogação, limpeza do cache ao ser revogado |
| Roubo do SQLite do host | só hashes no cache; PIN bcrypt; cartão/token SHA-256; permissão restrita ao arquivo (PENDENTE) |
| Replay de evento | chave de idempotência única |
| Replay/forja de comando de abertura | HMAC por agente + id de uso único + expiração curta (`commands.js`, testado); emissor/chave PENDENTES |
| Snapshot trocado entre tenants | vínculo único tenant/site, rejeição de snapshot de outro vínculo |
| Cache envenenado/corrompido | validação estrita de formato; falha mantém cache anterior |
| Revogação não propagada por falta de rede | teto de idade do cache + `degraded_deny` |
| Força bruta de PIN offline | bloqueio local por pessoa; hash dummy contra enumeração |
| Relógio adulterado | deriva medida no heartbeat; `assessClock` implementado e usado na decisão |

## 13. Pendências (para o status)

1. **4C (restante):** publicação do `edge-gateway` e migrations no remoto (depende do dono); rate limit global (hoje por isolate); executável/serviço que inicia `runLoop` (4E).
2. **4D (restante):** emissor/chave de comando, driver real, acionar o HAL na decisão (vertical slice).
3. **4E (proposto):** endurecimento do host (cofre de segredo, logs com rotação, atualização segura, versão mínima, watchdog).
4. Calibrar com clientes: `maxSnapshotAgeMs`, tolerância de relógio, política de retenção da fila.
5. Decidir mTLS vs. segredo por agente (registrar em `19-DECISIONS.md`).
6. Presença com múltiplos agentes por zona.
