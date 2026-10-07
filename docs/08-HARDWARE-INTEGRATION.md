# 08 — Integração de hardware

Estado: Fase 4D (07/10/2026). Cadeia: domínio → abstração (HAL) → driver → protocolo/SDK → dispositivo. Nenhum protocolo de fabricante foi inventado; **não existe driver real ainda**.

## 1. Contrato HAL (`packages/device-drivers/src/contract.js`)

`HardwareDriver`: `kind`, `unlock(pointId, {durationMs})`, `lock(pointId)`, `getStatus(pointId)`, `onEvent(handler)`, `tick(now)`.

- Resultado: `{ ok, code }` com códigos estáveis `OK`, `DEVICE_OFFLINE`, `TIMEOUT`, `UNKNOWN_POINT`, `INVALID_ARGUMENT`.
- Destrava sempre por tempo limitado (inteiro, 1 ms a 60 s) e religa sozinho.
- Eventos: `access.requested/granted/denied`, `door.opened/closed/forced/held_open`, `device.online/offline`, `heartbeat`, `clock_sync`.
- O driver **não decide**: quem chama já autenticou/autorizou (motor determinístico).

## 2. Mock Hardware (`mock-hardware.js`)

Só dev/teste: lança erro com `NODE_ENV=production`. Simula leitor online/offline, credencial válida/inválida, porta aberta/forçada/mantida aberta, timeout (`faults.timeoutNext`), duplicidade de evento (`faults.duplicateNext`). Tempo determinístico por `tick()`. Atraso de comunicação, fila offline e reconexão são exercitados pelo Edge (fila/sync), não pelo mock.

## 3. Comandos assinados (`apps/edge-agent/src/commands.js`)

Envelope `{v:1, id, agent_id, action: unlock|lock, point_id, duration_ms?, issued_at, expires_at, signature}`.

Verificação, nesta ordem: formato → `agent_id` do agente → HMAC-SHA256 (hex) sobre forma canônica posicional, comparação em tempo constante → janela (`expires_at − issued_at ≤ 60 s`, `issued_at` até 30 s no futuro, não expirado) → **anti-replay** (`command_nonces`, id de uso único; só consome o id após assinatura e janela válidas) → driver. Códigos de rejeição: `MALFORMED`, `WRONG_AGENT`, `BAD_SIGNATURE`, `INVALID_WINDOW`, `NOT_YET_VALID`, `EXPIRED`, `REPLAY`. Falha do driver consome o id; nova tentativa exige novo comando.

## 4. Limites e pendências

- **IMPLEMENTADO e TESTADO (4E, D-021)**: emissor e entrega de `unlock` e `lock`. `request_device_command` (permissão `device:command` por site, motivo, auditoria; `lock` não aceita duração) → `edge-gateway` `poll_commands` assina com a chave do agente (HMAC da `COMMAND_MASTER_KEY` com o id; `scripts/command-key.mjs`) → `command-poll.js` verifica, aciona o HAL e reporta. UI do operador (Abrir/Travar remotamente, lista de comandos que se atualiza sozinha enquanto há comando em aberto). Rotação da mestra: o agente aceita lista de chaves (atual + anterior; `EDGE_COMMAND_KEY`/`EDGE_COMMAND_KEY_PREVIOUS`), E2E cobre os dois lados. Daemon `apps/edge-agent/src/main.js` monta `commands` no laço. **`lock` remoto**: reafirma o estado travado; não impede saída (saída livre é do hardware e do `emergency_behavior`); permanece sujeito à mesma permissão, motivo, 1 pedido em aberto por ponto e auditoria. **Relógio**: com relógio não confiável (`assessClock`), `unlock` é recusado com `CLOCK_UNTRUSTED` sem consumir o id; `lock` segue. **PENDENTE (depende de algo não implementado)**: `kid` na assinatura (rotação sem lista, só se houver mais de 2 gerações), canal seguro de instalação da chave no agente (hoje cópia manual), driver real (Fase 8, depende de dispositivo e documentação oficial do fabricante).
- **PENDENTE**: driver real (exige documentação oficial do fabricante) — requisito antes do release operacional.
- **IMPLEMENTADO (Edge, Mock)**: vertical slice `handleAccessAttempt` (`access.js`): credencial → `evaluateAccess` → evento na fila + presença (transação) → `driver.unlock` só se a decisão for de abertura. Decisão/evento são gravados antes do hardware. **Limite**: se o driver falhar (offline/timeout), o evento fica como ALLOW e a presença já avançou (anti-passback pode gerar violação falsa); a falha só aparece no retorno (`actuation`), não na nuvem. Falha de atuação é reportada à nuvem (TESTADO em `cloud-slice.e2e.mjs`); reverter a presença segue PENDENTE (decisão de produto sobre anti-passback). Sem hardware real.
- **PENDENTE**: fail-safe/fail-secure por ponto aplicado no driver; emergência: nenhum caminho aqui bloqueia saída segura (o contrato não tem “trancar permanentemente”).
- Relógio: a validade usa o relógio do host; `pollAndRunCommands` consulta `assessClock` e recusa `unlock` com `CLOCK_UNTRUSTED` quando o relógio não é confiável (HIPÓTESE dos limites 60 s/300 s/24 h).
