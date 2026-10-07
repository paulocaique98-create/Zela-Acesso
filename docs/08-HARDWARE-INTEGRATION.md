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

- **PENDENTE**: emissor (assinatura na nuvem) e distribuição/rotação da chave de comando por agente (o segredo do agente está só como hash na nuvem; a chave de comando precisa de canal próprio). Decidir junto com mTLS vs. segredo (`19-DECISIONS.md`).
- **PENDENTE**: driver real (exige documentação oficial do fabricante) — requisito antes do release operacional.
- **IMPLEMENTADO (Edge, Mock)**: vertical slice `handleAccessAttempt` (`access.js`): credencial → `evaluateAccess` → evento na fila + presença (transação) → `driver.unlock` só se a decisão for de abertura. Decisão/evento são gravados antes do hardware. **Limite**: se o driver falhar (offline/timeout), o evento fica como ALLOW e a presença já avançou (anti-passback pode gerar violação falsa); a falha só aparece no retorno (`actuation`), não na nuvem. PENDENTE: reportar falha de atuação e reverter presença. Não testado de ponta a ponta com a nuvem (Edge Function/banco) nem com hardware real.
- **PENDENTE**: o resultado do comando não é reportado à nuvem (a ingestão aceita só `access_decision`).
- **PENDENTE**: fail-safe/fail-secure por ponto aplicado no driver; emergência: nenhum caminho aqui bloqueia saída segura (o contrato não tem “trancar permanentemente”).
- Relógio: a validade usa o relógio do host; com deriva alta o comando pode ser aceito/recusado indevidamente (`assessClock` ainda não é consultado aqui).
