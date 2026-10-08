-- Fase 9D (backlog #8): guarda de esquema. O Postgres/Storage da nuvem nao guarda gabarito, imagem nem vetor biometrico;
-- so referencia opaca (template_ref). Se alguem criar coluna binaria/vetor em tabela biometrica ou bucket publico, o teste falha.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name like '%biometric%'
              and (udt_name in ('bytea', 'vector') or data_type = 'ARRAY' or column_name ~* '(image|photo|vector|embedding|descriptor|raw)')),
  0, 'tabelas biometricas sem coluna binaria, vetor ou imagem');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and column_name ~* '(template_data|face_image|fingerprint|embedding)'
              and table_name <> 'error_logs'),
  0, 'nenhuma tabela publica guarda dado biometrico bruto (error_logs.fingerprint e hash de agrupamento de erro)');
select is((select count(*)::int from storage.buckets where public), 0, 'nenhum bucket publico');
select is((select count(*)::int from storage.buckets where name ~* '(biometr|template|face)'), 0,
  'sem bucket de biometria: gabaritos ficam no provedor/Edge, nao no Storage da nuvem');

select * from finish();
rollback;
