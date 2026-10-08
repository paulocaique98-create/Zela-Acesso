# 14 — Threat Model

Revisão da Fase 9C (07/10/2026). P = probabilidade, I = impacto (B/M/A). **Risco residual** = risco que sobra com a mitigação *como está hoje* (não como planejada). **Teste** = o que comprova a mitigação; "NÃO TESTADO" e "NÃO IMPLEMENTADO" são ditos às claras. Probabilidade/impacto e residual são julgamento da equipe, ainda sem revisão externa nem pentest.

Legenda de estado: TESTADO (há teste automatizado executado) · IMPLEMENTADO (código existe, sem teste que o prove) · PENDENTE (não existe).

| Ameaça | P | I | Mitigação (estado) | Teste | Risco residual |
|---|---|---|---|---|---|
| Tenant escape | M | A | RLS em tudo, tenant derivado da sessão — TESTADO | pgTAP `01`–`23` (cross-tenant em cada fase); Playwright `tenant-isolation.spec.js` | **Baixo**. Nova tabela sem teste cross-tenant reabre o risco: manter como critério de pronto |
| Account takeover | M | A | MFA TOTP por AAL2 (desligado por padrão), códigos de recuperação, bloqueio após 5 erros, rate limit nas funções — TESTADO | pgTAP `22`, `23`; Playwright `mfa.spec.js`; Vitest `edge-gateway.test.js` (429) | **Médio** enquanto a exigência estiver desligada; JWT segue aal2 até renovar após remover fator; sem detecção de login anômalo (PENDENTE) |
| Roubo de credencial/PIN | M | M | PIN só com hash, 6–8 dígitos, tokens de alta entropia + expiração, bloqueio por falhas — TESTADO | pgTAP `05`; Vitest `credentials.test.js`, `access.test.js` | **Baixo/Médio**: PIN curto sujeito a força bruta offline se o hash vazar; sem alerta de uso fora de padrão |
| Roubo de biometria | B | A | Biometria desligada por padrão, consentimento, eliminação com confirmação do Edge — TESTADO. **Verificado (07/10/2026)**: o Postgres só guarda referência opaca (`template_ref`); não há coluna binária/vetor/imagem em tabela biometrica nem bucket de Storage (público ou de biometria) | pgTAP `18`, `19`, `25` (guarda de esquema); E2E `biometric-erasure.e2e.mjs`; Vitest `biometrics` | **Alto até haver provedor real** (D-007): onde e como o provedor cifra o gabarito segue NÃO VERIFICADO; plano de incidente (06-LGPD) não é teste |
| Comprometimento de device | M | A | Enrollment e estados do agente — TESTADO; **mTLS: NÃO IMPLEMENTADO** | pgTAP `12`, `13`, `14` | **Alto**: sem mTLS nem atestação, segredo roubado do agente permite se passar por ele |
| Injeção de comando físico | B | A | Comando assinado (HMAC), id único, escopo/tenant/ponto, `unlock` recusado com relógio não confiável — TESTADO | Vitest `commands.test.js`, `command-poll.test.js`, `runner.test.js`; pgTAP `20`; E2E `device-command.e2e.mjs` | **Médio**: chave mestra copiada manualmente, sem `kid` na assinatura nem canal seguro de instalação; rotação manual |
| Replay | M | A | Id único de comando (REPLAY), idempotência na ingestão — TESTADO | `commands.test.js` (replay rejeitado); pgTAP `14` (ingestão idempotente) | **Baixo** para comandos; replay de eventos depende da chave de idempotência |
| Falsificação de evento | M | A | Autenticação do agente, cadeia de hash por tenant com `verify_access_chain` — TESTADO; varredura horária `scan_access_chains` (pg_cron) abre alerta crítico `chain_broken` — TESTADO (pgTAP) | pgTAP `10`, `14`, `24`; E2E `cloud-slice.e2e.mjs`; restauração de backup revalida a cadeia (`db-backup.mjs verify`) | **Médio**: agendamento depende de pg_cron no ambiente (NÃO verificado no remoto); cadeia não é ancorada fora do banco |
| Manipulação de relógio | M | M | Relógio de device e servidor registrados, `CLOCK_UNTRUSTED` recusa unlock/offline estrito — TESTADO | Vitest `decide.test.js`, `access.test.js`, `command-poll.test.js` | **Baixo/Médio**: sem alerta de drift para o operador |
| Roubo do cache offline | M | A | Snapshot e fila de eventos cifrados em repouso (AES-256-GCM, chave `EDGE_STORE_KEY` obrigatória em produção) — IMPLEMENTADO e TESTADO | `seal.test.js` (arquivo SQLite não contém o texto puro; chave errada/adulteração falham) | **Médio**: presença, contadores de PIN e ids ficam em claro; a chave vive no ambiente da mesma máquina (protege disco/backup roubado, não um atacante com a máquina ligada e root); sem cofre/TPM; rotação da `EDGE_STORE_KEY` não implementada |
| Escalada de privilégio | M | A | RBAC recurso+ação+escopo, `rbac:drift` no CI — TESTADO | Vitest `rbac.test.js`; pgTAP por papel em cada fase; `rbac:drift` (217 idênticas) | **Baixo/Médio**: papéis sujeitos ao MFA a validar com o dono |
| Insider / suporte Arx | B | A | `platform_support` e `platform_owner` não têm policy RLS sobre pessoas, credenciais, eventos, auditoria, visitas, biometria nem LGPD — TESTADO (guarda de esquema). JIT não é necessário enquanto não existir tela de suporte sobre dado do cliente | pgTAP `03`, `04`, `27` | **Médio**: equipe lê tenants, contratos, detalhes, perfis (nome/e-mail) e `error_logs`; função `SECURITY DEFINER` nova com acesso de equipe não é pega pelo teste 27; sem revisão periódica de quem é platform admin; JIT só se criarem suporte sobre dado do cliente |
| Abuso de webhook/API | M | M | Rate limit no `edge-gateway`: local por instância + global por agente contado no banco (`edge_rate_check`, 120/min) — TESTADO. **Webhooks de saída não existem** | Vitest `edge-gateway.test.js`; pgTAP `26` | **Baixo/Médio**: se o contador falhar vale só o limite local (fail-open deliberado); janela fixa; limite por IP e antes da autenticação NÃO existem; E2E com várias instâncias reais NÃO executado |
| Instalador malicioso | B | A | Papel `installer` com escopo mínimo — TESTADO | pgTAP `02`, `05`–`08`, `12` | **Baixo/Médio**: instalador fisicamente no local pode adulterar a fiação; fora do software |
| Controladora comprometida | B | A | Camada de driver isolada; **driver real não existe**, só mock | `mock-hardware.test.js` | **Não avaliável**: depende da Fase 8; segmentação de rede e firmware são do ambiente do piloto |
| Supply chain | M | A | Lockfile com `--frozen-lockfile`, varredura de segredos no bundle e `pnpm audit --audit-level=high` — IMPLEMENTADO no CI (local: sem vulnerabilidades); scan de skills/plugins: PENDENTE | CI `ci.yml` | **Médio**: auditoria só pega CVE conhecida; passo não executado ainda no runner do GitHub |
| Abertura/bloqueio indevido | M | A | Motor determinístico, política offline explícita — TESTADO | Vitest `access-engine.test.js`, `policy.test.js`, `schedule.test.js`, `antipassback.test.js`; pgTAP `08`, `11` | **Médio**: sem testes de propriedade (o plano citava) e sem alerta proativo de comportamento anômalo |
| Bloqueio de saída em emergência | B | A | Software nunca bloqueia saída; fail-safe/secure por ponto; `lock` só reafirma estado — TESTADO em regra de domínio | Vitest `access-point.test.js`, `commands.test.js` | **Alto até validação física**: checklist de bombeiros da UF e teste em hardware real (Fase 8) pendentes (`21-`) |

## Riscos que o modelo anterior não tratava (emenda R1)

| Risco | P | I | Estado | Teste | Risco residual |
|---|---|---|---|---|---|
| Indisponibilidade (nuvem ou Edge fora) | M | A | Edge decide offline, fila persistente, DEGRADED_* — IMPLEMENTADO e TESTADO por unidade | Vitest `decide.test.js`, `store.test.js`, `runner.test.js`; E2E `cloud-slice.e2e.mjs` | **Médio**: sem SLA; alerta de agente offline existe (`scan_offline_agents`, Fase 6); backup/restore local testado (`22-BACKUP-DR.md`), backup do provedor NÃO verificado |
| Fraude de credencial (empréstimo de PIN/cartão, tailgating) | A | M | Anti-passback, auditoria, múltiplas credenciais, revogação — TESTADO | pgTAP `11`; Vitest `antipassback.test.js` | **Médio**: PIN/cartão não prova identidade; biometria depende de provedor real; tailgating é físico |
| Falha de sincronização | M | M | Fila persistente, retry/backoff, idempotência — TESTADO | `transport.test.js`, `drain` via `runner.test.js`; pgTAP `14` | **Baixo/Médio**: fila crescente sem limite/alerta documentados |
| Configuração de emergência incorreta | B | A | Modo fail-safe/secure por ponto — IMPLEMENTADO | Vitest `access-point.test.js` | **Alto**: nada impede o instalador de configurar errado; só validação humana no local |
| Perda de dados / sem backup-restore | B | A | Procedimento e script `scripts/db-backup.mjs` (`22-BACKUP-DR.md`) — IMPLEMENTADO local | TESTADO local (restauração confere contagens e `verify_access_chain`); Storage, backup do provedor e remoto NÃO verificados | **Médio** (alto até validar backup do provedor) |

## Zela Pass: leitor em tablet/celular (D-027, 08/10/2026)

Detalhes em `25-ZELA-PASS-DESENHO.md`. Estado: IMPLEMENTADO e TESTADO local; **sem pentest, sem teste em aparelho real**.

| Ameaça | P | I | Mitigação (estado) | Risco residual |
|---|---|---|---|---|
| Leitor falso / mensagem forjada | M | A | Assinatura Ed25519 por mensagem com chave do aparelho (privada não extraível), nonce, ±120 s, ativação com prova de posse — TESTADO (Vitest, E2E) | **Baixo/Médio**: a privada fica protegida pelo navegador/SO, sem atestação de hardware |
| Replay de mensagem ou de leitura | M | M | Nonce único + `deviceEventId` idempotente — TESTADO | Baixo |
| Tablet roubado/perdido | M | A | Revogação no painel (irreversível, auditada); Edge recusa após o próximo snapshot — TESTADO | **Médio**: até 5 min de janela; roubo do aparelho + conhecimento de credenciais ainda registra marcação |
| Força bruta de senha pelo leitor | M | M | Bloqueio por pessoa (5 → 5 min), 30 msg/min por leitor, resposta igual para identificador inexistente — TESTADO | Médio: bloqueio por pessoa permite negar serviço a quem conhece a matrícula |
| Foto/cópia de QR ou código de barras | A | M | Token móvel com expiração e revogação; cartão por hash. QR estático impresso continua copiável | **Médio** (inerente à credencial); mitigar com validade curta |
| Vazamento de segredo em log/evidência/tela | M | A | Evidência e registros só guardam método/resultado; Registros sem nome nem valor; testes procuram PIN/token/cartão — TESTADO | Baixo |
| Interceptação na LAN | M | A | TLS obrigatório em produção fora de loopback (`config.js`); mensagens já assinadas — config TESTADO, **TLS real NÃO testado** | **Médio** até haver certificado confiável por cliente |
| Operador não autorizado mexe no tablet | M | M | PIN local (PBKDF2, 5 erros = 5 min); desativar só apaga o aparelho — TESTADO | **Médio**: guarda local, não autenticação forte; quem tem o aparelho pode apagá-lo (o painel mostra "ativo" até revogar) |
| Relógio do tablet adulterado | M | M | Hora do Edge manda; desvio corrigido por mensagem — TESTADO | Baixo |
| XSS/conteúdo malicioso no PWA | B | A | CSP `default-src 'self'` sem inline, sem dependência de CDN, bundle varrido por segredos — TESTADO (navegador sem violação de CSP) | Baixo |
| Código de ativação interceptado | B | M | Alta entropia, uso único, 24 h, só hash no banco/snapshot, mostrado uma vez — TESTADO | Baixo/Médio até o uso |
| Edge comprometido | B | A | Fora do escopo do leitor: mesmo risco do agente (ver acima); leitor revogado não ajuda | Ver Edge |

## Facial no Zela Pass (D-028, 08/10/2026)

| Ameaça | Mitigação (estado) | Evidência | Risco residual |
|---|---|---|---|
| Foto, tela ou vídeo diante da câmera (ataque de apresentação) | Liveness passiva do Human (antispoof + liveness, mediana de 5 quadros) exigida pela política (`require_liveness`, padrão sim) — IMPLEMENTADO; eficácia **NÃO validada** | `summarize.test.js`; E2E `face.browser.mjs`; sem teste ISO/IEC 30107-3 | **Alto** sem 2º fator; **Médio** com o segundo fator do ponto ligado (PIN depois do facial, D-031, `reader-face.test.js`) até haver teste de ataque de apresentação |
| Aparelho/leitor comprometido envia vetor ou liveness falsos | Mensagem assinada Ed25519 por aparelho, anti-replay, relógio, limite de taxa, revogação na nuvem; decisão final no Edge — IMPLEMENTADO e TESTADO | `reader-service.test.js`, `reader-face.test.js` | **Médio**: vetor e liveness vêm do aparelho; recalcular no Edge não foi feito |
| Roubo do gabarito (disco do Edge) | AES-256-GCM em repouso, `EDGE_STORE_KEY` obrigatória em produção — IMPLEMENTADO e TESTADO | `face-provider.test.js` | Chave no ambiente da mesma máquina (ver linha "Roubo do cache offline") |
| Imagem do rosto vazando | Imagem só no `<video>`/canvas do tablet; nunca gravada nem enviada; só o vetor sai — IMPLEMENTADO | E2E confere IndexedDB/localStorage e fila do Edge | Navegador do tablet fora do nosso controle (extensões, espelhamento de tela) |
| Pessoa cadastrada por quem não deveria / rosto sob duas identidades | Cadastro só com perfil criado no painel (consentimento registrado, permissão `biometric:enroll`), código de uso único, não sobrescreve, recusa rosto já cadastrado, PIN do operador no tablet — IMPLEMENTADO e TESTADO | `reader-face.test.js` | Código de captura em tela do painel (8 hex); quem tem o código e um leitor ativado captura uma vez |
| Falso aceite entre pessoas parecidas | Limiar da organização (mín. 0,80), margem 1:N de 0,05, recusa de ambíguo — IMPLEMENTADO | `face-provider.test.js`; benchmark `26-` | Sem medição com a população real nem recorte demográfico: **PENDENTE** |
| Negação de serviço (tentativas em massa) | 30 tentativas/min por leitor, teto por origem antes de autenticar — herdado do Zela Pass | `reader-service.test.js` | Custo de CPU do 1:N cresce com o número de gabaritos (linear) |
| Retenção/eliminação (LGPD) | Retenção, revogação e expiração apagam o gabarito pela fila de eliminação e confirmam à nuvem — IMPLEMENTADO e TESTADO | `reader-face.test.js` (eliminação) | Cópias de segurança do SQLite do Edge não são tratadas |

## Resumo do checkpoint de segurança (§70)

- Isolamento, RBAC, auditoria e comando assinado têm cobertura automatizada sólida.
- **Fechado na 8A (08/10/2026, D-022)**: `kid` e chave pública na assinatura de comando (roubo do agente não forja abertura) e prova de posse do dispositivo por requisição assinada no lugar de mTLS (Edge Function não exige certificado de cliente). Evidência: Vitest (`keys`, `trust`, `commands`, `device-key`, `edge-gateway-8a`), pgTAP 28, E2E `device-key.e2e.mjs`. Residual: privada do dispositivo protegida só pelo SO (sem TPM/cofre), `EDGE_ALLOW_LEGACY_AGENTS` permissivo por padrão, sem nonce por requisição.
- Lacunas **abertas** (07/10/2026, após a 9D; mTLS/`kid` removidos acima): backup do provedor e Storage, pg_cron no remoto, cofre/rotação da `EDGE_STORE_KEY`, cifragem do gabarito no provedor biométrico real, validação física de emergência, parecer formal do dono (Security Audit + Adversarial Verify), pentest.
- Esta revisão é documental: nenhum código foi alterado e nenhum teste novo foi criado. "Risco residual" é estimativa, não medição; **não há pentest nem auditoria externa**.
- Fechados na 9D: `pnpm audit` no CI, cifragem do SQLite do Edge, backup/restore local, varredura de cadeia, fronteira de dados da equipe, guarda de biometria, rate limit global.
