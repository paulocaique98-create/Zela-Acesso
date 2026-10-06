# 07 — Matriz Regulatória (FASE 0, inicial)

Data: 2026-10-06. Não substitui parecer jurídico. Nenhuma linha afirma conformidade.
"Verificado" = lido em fonte oficial nesta sessão. Demais itens = conhecimento prévio, a revalidar.

| Tema | Fonte | Tipo | Requisito | Implementação prevista | Evidência | Status | Resp. |
|---|---|---|---|---|---|---|---|
| Tratamento de dados, biometria sensível | Lei 13.709/2018 (LGPD) | Lei | Finalidade, minimização, segurança, direitos do titular, base legal | Retenção, DSR, base legal por finalidade, biometria desligada por padrão | — | EM VALIDAÇÃO | Arx + jurídico |
| Comunicação de incidente | Res. CD/ANPD 15/2024 | Regulamento | Registro, classificação e apoio à comunicação pelo controlador | Módulo de incidentes, preservação de evidência | Vigência verificada em gov.br/anpd (06/10/2026) | EM VALIDAÇÃO | Arx |
| Encarregado | Res. CD/ANPD 18/2024 | Regulamento | Papel do encarregado | Campo/contato por tenant | Vigência verificada | DEPENDENTE DE CLIENTE | Cliente |
| Transferência internacional | Res. CD/ANPD 19/2024 | Regulamento | Cláusulas-padrão se dados saírem do BR | Escolher região de hospedagem; revisar subprocessadores | Vigência verificada (retificada 18/08/2025) | EM VALIDAÇÃO | Arx |
| Biometria e reconhecimento facial | ANPD — Guia de Biometria e Reconhecimento Facial (24/06/2026) | Orientação | Transparência ativa, avisos no ponto de coleta, cautela com grupos vulneráveis | Provider abstrato, avisos, alternativa não biométrica | Existência confirmada por notícias; **conteúdo integral NÃO lido** | EM VALIDAÇÃO — ler na íntegra antes da Fase 7 | Arx |
| Reconhecimento facial em escolas | ANPD — Nota Técnica 4/2026 (PR) | Ação de fiscalização | Suspensão de FR para frequência em escolas públicas do PR | Biometria de menores nunca é padrão | Notícia secundária; NT não lida | EM VALIDAÇÃO | Arx + jurídico |
| ECA Digital | Lei 15.211/2025; Decretos 12.622/2025 e 12.880/2026 | Lei/Decreto | Foco da ANPD em serviços digitais online; vigência março/2026 | Categoria etária, responsável legal | Resumo de gov.br/anpd; aplicabilidade a controle físico NÃO confirmada | DEPENDENTE DE PARECER JURÍDICO | Jurídico |
| Segurança privada | Lei 14.967/2024 | Lei | Monitoramento de sistemas eletrônicos de segurança é serviço regulado (PF) | MVP = software; sem central de monitoramento Arx | **Planalto inacessível (ECONNRESET ×2); artigos NÃO verificados** | DEPENDENTE DE PARECER JURÍDICO | Jurídico |
| Proteção contra incêndio / saídas | NR-23 (Portaria MTP 2.769/2022) | Norma reg. | Saídas de emergência desobstruídas | fail-safe/secure por ponto; software nunca bloqueia saída | Versão vigente confirmada; itens de portas/travas NÃO lidos (PDF) | DEPENDENTE DE INSTALAÇÃO | Instalador/cliente |
| Acessibilidade | ABNT NBR 9050 | Norma técnica | Rotas/pontos acessíveis | Campo de acessibilidade por ponto; alternativa à biometria | Norma licenciada, não consultada | DEPENDENTE DE NORMA LICENCIADA | Instalador |
| Controle de acesso eletrônico | IEC 60839-11-1 / 11-2 | Norma técnica | Requisitos de sistema e aplicação | Referência de projeto, sem alegar certificação | Norma licenciada, não consultada | DEPENDENTE DE NORMA LICENCIADA | Arx |
| Segurança contra incêndio estadual | ITs do CBM de cada UF | Norma estadual | Variável por estado | Registro por instalação | — | DEPENDENTE DE INSTALAÇÃO | Instalador |
| Ponto eletrônico | Portarias MTE | Regulamento | Fora de escopo | Apenas eventos de integração futura | — | NÃO APLICÁVEL (Zela Acesso) | — |

## Lacunas a fechar antes de qualquer recurso sensível
1. Ler o Guia ANPD de Biometria na íntegra (antes da Fase 7).
2. Reabrir a Lei 14.967 no Planalto e registrar os artigos (antes da Fase 6).
3. Obter o texto da NR-23 (itens de saída) e as ITs do CBM da UF do piloto (antes da Fase 8).
