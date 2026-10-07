-- Fase 7B: novo codigo de motivo estavel BIOMETRIC_REJECTED (credencial biometrica sem verificacao aceita).
-- Apenas amplia o CHECK; eventos existentes continuam validos.
alter table public.access_events drop constraint access_events_reason_code_check;
alter table public.access_events add constraint access_events_reason_code_check check (reason_code is null or reason_code in (
    'POLICY_MATCH', 'POLICY_DENY', 'ZONE_NOT_ALLOWED', 'OUTSIDE_SCHEDULE', 'MULTI_FACTOR_REQUIRED',
    'CREDENTIAL_INVALID', 'CREDENTIAL_EXPIRED', 'PERSON_DISABLED', 'VISITOR_EXPIRED', 'VISITOR_ZONE_NOT_ALLOWED',
    'ANTI_PASSBACK', 'EMERGENCY_POLICY', 'DEVICE_UNTRUSTED', 'ACCESS_POINT_INACTIVE', 'OFFLINE_POLICY_DENY',
    'OFFLINE_POLICY_ALLOW', 'CONTEXT_INVALID', 'BIOMETRIC_REJECTED'));
