# 22 — Backup, restauração e recuperação de desastre

Origem: backlog de segurança #3 (Fase 9C). Escopo verificado: **banco Postgres local** (`zela-acesso-local`). O que depende do projeto Supabase remoto está marcado como HIPÓTESE/PENDENTE.

## O que é coberto
| Dado | Mecanismo | Estado |
|---|---|---|
| Postgres (schemas `public`, `auth`, `app_private`): tenants, pessoas, credenciais (hash), eventos, auditoria | `node scripts/db-backup.mjs backup` (pg_dump `-Fc`) | TESTADO local |
| Prova de restauração | `node scripts/db-backup.mjs verify` | TESTADO local |
| Storage (fotos, templates biométricos, anexos) | NÃO coberto pelo pg_dump | PENDENTE |
| Cache SQLite do Edge Agent | Reconstruído da nuvem no próximo sync; fila pendente local pode se perder | HIPÓTESE (não testado) |
| Chaves (`COMMAND_MASTER_KEY`, secrets) | Fora do backup por desenho; guardar no cofre do dono | PROCEDIMENTO |

## Procedimento
1. **Backup**: `node scripts/db-backup.mjs backup` gera `backups/zela-acesso-<data>.dump` (pasta ignorada pelo git). O arquivo contém dado pessoal: cifrar e guardar fora do repositório.
2. **Verificar** (obrigatório após cada backup relevante e antes de qualquer mudança arriscada): `node scripts/db-backup.mjs verify [arquivo]`. Restaura num banco descartável `restore_check`, compara contagens (`tenants`, `people`, `access_events`, `audit_log`, `auth.users`) com a origem e roda `verify_access_chain` em cada organização. Falha se qualquer contagem diferir ou a cadeia quebrar. O banco temporário é apagado ao fim.
3. **Restaurar de verdade** (desastre): criar o projeto/banco novo, aplicar `extensions` (pgcrypto, uuid-ossp), `pg_restore --no-owner --no-privileges`, reaplicar grants executando as migrations em banco vazio e só então restaurar os dados (ou usar o ambiente gerenciado). Depois: `verify_access_chain` por organização, `rbac:drift`, reemissão das chaves do Edge.

## Achados do teste
A restauração falhou na primeira tentativa por falta do schema `extensions`: `verify_access_chain` usa `extensions.digest`. Sem pgcrypto no schema `extensions` o hash dos eventos não recalcula e a cadeia parece quebrada. O script e este procedimento agora criam o schema antes.

## Metas (a validar com o dono)
- RPO proposto: 24 h (backup diário) — **não validado**; produção exige backup gerenciado/PITR do provedor, **não verificado**.
- RTO proposto: 4 h — **não medido** além do tempo da restauração local (segundos, base sintética).

## Limites
- Testado só com base sintética pequena; sem teste de volume.
- Não foi testada restauração no projeto remoto (proibido em desenvolvimento).
- Evidência de que o backup do provedor está ativo e restaurável: PENDENTE (dono).

A restauração também recusou o dump porque a origem tinha linhas órfãs em `edge_rate_hits` (o script de purge de testes apagava agentes sem disparar o CASCADE). Corrigido em `scripts/purge-tenants-dev.mjs`; o `--exit-on-error` do verify é o que expõe esse tipo de inconsistência.
