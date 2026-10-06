# 03 — Modelo de Domínio e ERD preliminar

Regra: toda tabela de negócio tem `tenant_id NOT NULL` (direto ou por FK verificável) e RLS. Entidades só são criadas quando a fase as exige.

## Hierarquia
```
tenant → site → building → floor → zone → access_point
```

## Núcleo (Fases 1–3)
| Entidade | Chaves/relações | Observações |
|---|---|---|
| tenant | PK id | timezone padrão, plano/limites (futuro) |
| membership | user_id → tenant_id, role, escopo (site/zone) | RBAC recurso+ação+escopo |
| site / building / floor / zone | FK em cascata lógica, `tenant_id` | timezone no site |
| person | tenant_id, tipo, categoria etária, status | dados mínimos; sem CPF por padrão |
| access_group, group_member | person ↔ group | |
| credential | person_id, tipo (CARD/PIN/QR/FACE/MOBILE), status, validade, revogação | segredo só como hash; nunca exibido |
| access_point | zone_id, direção, comportamento offline/emergência/falta de energia, timeout | |
| schedule, holiday_calendar | tenant_id | avaliados no timezone do site |
| access_policy, policy_rule | alvo (pessoa/grupo) × (zona/ponto) × schedule | declarativa e validável |
| access_attempt | idempotência: (device_id, device_event_id) UNIQUE | append-only |
| access_decision | decision enum, reason_code estável, policy_id | append-only |
| access_evidence | JSON estruturado + `prev_hash`/`hash` | append-only; correções = novo evento |
| presence_state | person × zone, PRESENT/ABSENT/UNKNOWN/CONFLICTED | derivado + confiança |
| audit_log | actor, ação, antes/depois, motivo, correlation_id | append-only |

## Edge / dispositivos (Fase 4)
device (trust: TRUSTED/SUSPECT/REVOKED; status: ONLINE/OFFLINE/DEGRADED/MAINTENANCE/REVOKED/UNKNOWN), edge_agent, device_heartbeat, device_command (idempotency_key, assinatura, resultado).

## Posteriores
visitor/visit (F5), alert_rule/alert_event/incident/emergency_* (F6), biometric_profile (F7), data_subject_request, consent_record, retention_policy, webhook_subscription, api_key (conforme necessidade).

## Decisão de acesso
`ALLOW | DENY | CHALLENGE | DEGRADED_ALLOW | DEGRADED_DENY` + `reason_code` (CREDENTIAL_INVALID, CREDENTIAL_EXPIRED, PERSON_DISABLED, OUTSIDE_SCHEDULE, ZONE_NOT_ALLOWED, VISITOR_EXPIRED, ANTI_PASSBACK, EMERGENCY_POLICY, DEVICE_UNTRUSTED, OFFLINE_POLICY_ALLOW/DENY, POLICY_MATCH, MULTI_FACTOR_REQUIRED, ...). Códigos são contrato estável.

## Campos imutáveis
Eventos, decisões, evidências e audit_log: sem UPDATE/DELETE (revogados por privilégio e trigger).
