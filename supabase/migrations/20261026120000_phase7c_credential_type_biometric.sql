-- Fase 7C (1/2): novo tipo de credencial `biometric`. Fica em arquivo proprio porque um valor de enum
-- recem-criado nao pode ser usado na mesma transacao (constraint e funcoes entram na migration seguinte).
alter type public.credential_type add value if not exists 'biometric';
