-- Fase 8B (D-024): decisao tomada pelo proprio terminal em modo Standalone (Control iD, D-023). O motor nao a reavaliou,
-- entao entra como evidencia do dispositivo com codigos proprios; nunca como POLICY_MATCH/POLICY_DENY.
-- Apenas amplia o CHECK; eventos existentes continuam validos. A ingestao (`edge_ingest_events`) ja aceita `access_decision`.
alter table public.access_events drop constraint access_events_reason_code_check;
alter table public.access_events add constraint access_events_reason_code_check check (reason_code is null or reason_code in (
    'POLICY_MATCH', 'POLICY_DENY', 'ZONE_NOT_ALLOWED', 'OUTSIDE_SCHEDULE', 'MULTI_FACTOR_REQUIRED',
    'CREDENTIAL_INVALID', 'CREDENTIAL_EXPIRED', 'PERSON_DISABLED', 'VISITOR_EXPIRED', 'VISITOR_ZONE_NOT_ALLOWED',
    'ANTI_PASSBACK', 'EMERGENCY_POLICY', 'DEVICE_UNTRUSTED', 'ACCESS_POINT_INACTIVE', 'OFFLINE_POLICY_DENY',
    'OFFLINE_POLICY_ALLOW', 'CONTEXT_INVALID', 'BIOMETRIC_REJECTED', 'DEVICE_LOCAL_ALLOW', 'DEVICE_LOCAL_DENY'));
