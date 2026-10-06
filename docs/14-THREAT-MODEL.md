# 14 — Threat Model (inicial)

P = probabilidade, I = impacto (B/M/A). Risco residual será reavaliado na Fase 9.

| Ameaça | P | I | Mitigação | Detecção | Resposta |
|---|---|---|---|---|---|
| Tenant escape | M | A | RLS em tudo, tenant derivado da sessão, testes cross-tenant em CI | Testes + auditoria de consultas | Isolar tenant, rotacionar chaves |
| Account takeover | M | A | MFA admin, rate limit, revogação de sessão | Logins anômalos | Revogar sessões |
| Roubo de credencial/PIN | M | M | PIN com hash forte, tokens de alta entropia + expiração | Uso fora de padrão | Revogar credencial |
| Roubo de biometria | B | A | Biometria off por padrão, bucket privado, minimização, templates cifrados | Acesso a dados biométricos auditado | Plano de incidente e comunicação |
| Comprometimento de device | M | A | Enrollment, estado TRUSTED/SUSPECT/REVOKED, mTLS | Heartbeat/versão | Revogar device |
| Injeção de comando físico | B | A | Comandos assinados, escopo+tenant+ponto, idempotência | Auditoria de comandos | Bloquear agent |
| Replay | M | A | Nonce/timestamp/idempotency key | Rejeição registrada | Rotacionar segredo |
| Falsificação de evento | M | A | Autenticação do agent, hash encadeado | Verificação de cadeia | Quarentena de eventos |
| Manipulação de relógio | M | M | Registrar relógio do device e do servidor, tolerância de drift | Drift alertado | Política offline estrita |
| Roubo do cache offline | M | A | Cache mínimo, cifrado em repouso | — | Revogar agent e credenciais |
| Escalada de privilégio | M | A | RBAC recurso+ação+escopo, testes | Auditoria | Revisão de papéis |
| Insider / suporte Arx | B | A | Acesso JIT auditado, sem acesso padrão a dados | Log de acesso de suporte | Revogar acesso |
| Abuso de webhook/API | M | M | Assinatura, rate limit, retry limitado | Métricas | Desativar assinatura |
| Instalador malicioso | B | A | Papel `installer` com escopo mínimo | Auditoria | Revogar |
| Controladora comprometida | B | A | Segmentação de rede, firmware versionado | Heartbeat | Isolar |
| Supply chain | M | A | Lockfile, auditoria de deps, scan de skills/plugins | CI | Pin/rollback |
| Abertura/bloqueio indevido | M | A | Motor determinístico + testes de propriedade; política offline explícita | Alertas | Fallback manual |
| Bloqueio de saída em emergência | B | A | Fail-safe configurável; software nunca bloqueia saída | Revisão de instalação | Parar rollout |
