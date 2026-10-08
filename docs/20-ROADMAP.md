# 20 — Roadmap técnico

| Fase | Entrega | Saída (gate) |
|---|---|---|
| 0 | Auditoria, docs, matriz, threat model | Docs revisados; bloqueio de plugins resolvido ou aceito |
| 1 | Monorepo, CI, Supabase local isolado, Auth, tenants, RBAC, RLS, UI base | Testes cross-tenant verdes; reset local reproduzível |
| 2 | Sites, zonas, pessoas, grupos, credenciais, pontos, horários, políticas | CRUD com RLS testada |
| 3 | `evaluateAccess`, Access Evidence, eventos append-only, auditoria, anti-passback | Suíte do motor completa; hash encadeado verificável |
| 4 | Edge Agent: enrollment, heartbeat, cache, fila, sync, comandos; Mock Hardware | Cenários offline/duplicidade passando |
| 5 | Visitantes | Ciclo convite→check-out testado |
| 6 | Dashboard operacional, alertas, incidentes, presença (ler Lei 14.967 antes) | E2E operacional |
| 7 | Biometria via provider (Radar/NTs ANPD lidos; 7A–7C feitas, 7D pendente) | Benchmark e parecer jurídico registrados |
| 8 | Hardware real (1 fabricante com documentação) | Teste de bancada documentado |
| 9 | Hardening, backup/restore, DR | Security Audit + Adversarial Verify sem críticos |
| 10–11 | Piloto controlado → RC | Critérios da Seção 58 do Prompt-Mestre |
| Pós-MVP | Ferramenta de ponto virtual (pesquisa em `24-PONTO-VIRTUAL-PESQUISA.md`; exige o dono alterar o limite "acesso físico ≠ ponto") | Decisão REP-P x coletor, parecer jurídico e leitura oficial da Portaria 671 |

## Backlog de segurança (origem: Fase 9C, 07/10/2026)

Lacunas expostas na revisão de `14-THREAT-MODEL.md`. Nenhuma está implementada; o risco residual de cada uma está no threat model. Ordem sugerida:

| # | Item | Ameaça relacionada | Saída (gate) |
|---|---|---|---|
| 1 | ~~`pnpm audit` no CI~~ (feito 07/10/2026) | Supply chain | Passo no `ci.yml` falhando em vulnerabilidade alta/crítica |
| 2 | ~~Cifragem em repouso do SQLite do Edge~~ (feito 07/10/2026; `EDGE_STORE_KEY`) | Roubo do cache offline | Teste que prova dado ilegível sem a chave; gestão da chave definida |
| 3 | ~~Backup/restore e DR~~ (local feito 07/10/2026, `22-BACKUP-DR.md`; Storage e remoto pendentes) | Perda de dados, indisponibilidade | Procedimento escrito e restauração testada |
| 4 | ~~Rotina agendada de `verify_access_chain` + alerta~~ (feito 07/10/2026: `scan_access_chains`; agente offline já existia; drift de relógio sem alerta) | Falsificação de evento, indisponibilidade, relógio | Alerta ao operador testado |
| 5 | ~~Acesso JIT para suporte~~ (não necessário hoje: guarda de fronteira pgTAP `27`; reabrir se criarem suporte sobre dado do cliente) | Insider / suporte Arx | pgTAP: acesso expira e é auditado |
| 6 | ~~mTLS/atestação de agente~~ (feito 08/10/2026 como chave de dispositivo assinando cada requisição, D-022; privada só protegida pelo SO) | Comprometimento de device | Teste com agente sem certificado recusado |
| 7 | ~~`kid` na assinatura de comando e canal seguro de instalação da chave~~ (feito 08/10/2026, D-022: Ed25519, declarações endorse/revoke) | Injeção de comando físico | Rotação sem cópia manual |
| 8 | ~~Verificar bucket/cifragem dos templates~~ (nuvem: só `template_ref`, guarda pgTAP `25`; cifragem no provedor real segue pendente, D-007) | Roubo de biometria | Evidência registrada (hoje "não verificado") |
| 9 | ~~Rate limit global no `edge-gateway`~~ (feito 07/10/2026: `edge_rate_check`) | Abuso de API | Teste com múltiplas instâncias |
| 10 | Revisão formal do checkpoint de segurança (§70) pelo dono, Security Audit + Adversarial Verify (rascunho técnico feito 08/10/2026 em `23-SECURITY-REVIEW-8B.md`; parecer do dono PENDENTE) | Todas | Parecer sem críticos abertos |
| 11 | Validação física de emergência (checklist de bombeiros da UF, `21-`) | Bloqueio de saída / config. de emergência | Teste em bancada documentado (Fase 8) |
