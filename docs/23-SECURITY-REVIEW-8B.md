# 23 — Revisão de segurança da Fase 8 (Security Audit + Adversarial Verify)

Data: 08/10/2026. Escopo: driver Control iD (8B), receptor do Monitor/Push, sincronização de usuários (roster), alarme de porta, migration `20261106120000`. Método: leitura do código e testes de abuso escritos contra o simulador. **Não é pentest, não houve equipamento real e não substitui o parecer formal do dono** (backlog nº 10 de `20-ROADMAP.md`): o campo "Parecer" abaixo fica em branco até a revisão dele.

## Achados corrigidos nesta revisão

| # | Achado | Severidade | Correção | Teste |
|---|---|---|---|---|
| 1 | O roster calculava quem pode entrar ignorando cache defasado (> 7 dias) e relógio não confiável. Com relógio errado, o terminal poderia liberar alguém fora da janela de horário, ao contrário de `decide.js`. | Alta | `syncRosters` aplica a mesma cautela: ponto `degraded_deny` esvazia o roster; ponto `degraded_allow` congela (não adiciona nem remove). | `roster.test.js` (3 casos) |
| 2 | A fila de eventos do terminal não tinha teto: um host da LAN que conheça o segredo do Monitor poderia lotar o disco do Edge com notificações forjadas. | Média | `MAX_QUEUE_DEPTH` (20 000) em `device-events.js`; acima disso descarta com motivo `QUEUE_FULL`. | `device-events.test.js` |
| 3 | O snapshot da nuvem não trazia pessoas sem credencial na nuvem, então o roster as omitia (falha de disponibilidade, não de segredo). | Média | Migration `20261106120000` (só id e status, sem nome). | pgTAP `30_phase8b_snapshot_group_people` (4) e E2E `device-alarm` |

## Verificado e sem achado

- **Nenhum comando de abertura sem autenticação**: o driver só abre por `unlock` chamado pelo Edge após comando assinado; o Monitor/Push só informam eventos. Evento forjado nunca abre porta (só vira evidência `DEVICE_LOCAL_*` ou alerta).
- **Segredos**: senha do terminal só por variável de ambiente; `admin/admin` recusado em produção; o relatório `bench-controlid.mjs` e os logs do daemon não trazem cartão, PIN, senha, sessão nem corpo de notificação.
- **Roster**: não envia cartão, PIN, senha nem gabarito (teste `nunca grava cartão, PIN nem senha`); só toca em usuário `zela:<id>`; id alheio vira conflito; revoga antes de conceder.
- **Isolamento de tenant**: o snapshot é por agente (tenant/site); o agente é preso ao primeiro vínculo; a migration não amplia o escopo (membros de grupo do próprio site/tenant; pgTAP prova que outro tenant, outro site e política inativa ficam de fora).
- **Alarme de porta**: o evento sobe por `edge_ingest` com a mesma autenticação do agente; o gateway valida ponto/site do agente.

## Riscos residuais (aceitos ou dependentes de decisão)

| # | Risco | Impacto | Mitigação atual | Quem decide |
|---|---|---|---|---|
| R1 | O Monitor da Control iD não assina notificações e trafega em HTTP: quem estiver na LAN e sniffar o caminho secreto pode forjar `access.granted/denied` e `door.forced` (evidência falsa, alerta falso). Não abre porta. | Integridade da evidência | Segredo aleatório de 32+ caracteres no caminho; rede local segmentada; teto de fila (#2). Comparação do prefixo não é em tempo constante (exploração na LAN pouco provável). | Dono: VLAN dedicada aos terminais; HTTPS no Monitor se o firmware suportar (HIPÓTESE) |
| R2 | Modo Push usa caminhos fixos sem segredo; só confere IP de origem, `deviceId` e `uuid`. Host que falsifique o IP na LAN pode mentir sobre resultado de comando. | Integridade do resultado | Opt-in por ponto; documentado em D-024. | Dono: manter desligado salvo necessidade |
| R3 | Credencial (cartão/PIN/biometria) é cadastrada no terminal para o id `Zela <id>`; a mudança de titular de um cartão no terminal não é vista pelo Zela. | Rastreabilidade | O evento traz o `deviceUserId`; o roster remove quem perde a autorização. | Piloto |
| R4 | `door.forced` por botão ligado direto ao relé gera falso alarme; sem `doorSensor` não há detecção. | Falso positivo / lacuna | Opt-in por ponto. | Instalador |
| R5 | A janela de horário no terminal vale com até 60 s de atraso; revogação vale até o próximo ciclo do roster (60 s) e do snapshot (5 min). | Revogação tardia | Limite documentado. | Dono |
| R6 | Corpos de `load_objects` de regras e o `portal_id` são HIPÓTESES; resposta inesperada faz o sync falhar (não conceder). | Disponibilidade do roster | Falha fechada: erro sem alterar usuários além do que já foi feito. | Bancada |
| R7 | Chave privada do dispositivo e `EDGE_STORE_KEY` protegidas só pelo SO. | Roubo da máquina do Edge | Backlog de segurança (D-022). | Dono |

## Não coberto por esta revisão

Equipamento real; firmware do terminal; revisão formal do Security Audit/Adversarial Verify pelo dono; pentest; Hikvision/Intelbras/ZKTeco/Henry (sem driver).

## Parecer

Pendente — dono do produto: ______________________  data: __________  críticos abertos: ____
