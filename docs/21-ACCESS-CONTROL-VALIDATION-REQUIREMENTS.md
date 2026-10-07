# 21 — Exigências para validação de um sistema de Controle de Acesso (levantamento)

Data: 2026-10-07. Complementa `07-REGULATORY-MATRIX.md`. **Não é parecer jurídico e não afirma conformidade.**

## Como ler a evidência
- **LIDO-FONTE**: texto extraído do PDF/página oficial nesta sessão (NT 23/2025, NT 4/2026, Radar ANPD, NT CBMGO 11/2022).
- **LIDO-RESUMO**: página oficial/de repositório lida por ferramenta de resumo automático; números de artigo e citações precisam ser conferidos no texto oficial antes de qualquer uso contratual.
- **SECUNDÁRIO**: notícia, blog, loja de normas. Só indica existência.
- Normas ABNT/IEC/ISO/UL são licenciadas: **conteúdo não lido**, só título/escopo.

---

## 1. Proteção de dados (LGPD / ANPD)

| Item | Classe | Evidência | Exigência / achado | Implicação no produto |
|---|---|---|---|---|
| LGPD art. 5º II, 6º, 11, 14, 46, 49 | Lei | LIDO-FONTE (citados nas NTs) | Biometria = dado sensível; finalidade, necessidade, segurança, prestação de contas; menores = melhor interesse | Biometria desligada por padrão; finalidade fixa por perfil |
| Radar Tecnológico ANPD nº 2 (mai/2024) | Estudo não vinculante | LIDO-FONTE | Ver `07`: consentimento só se específico/destacado/transparente; coleta não informada o invalida | Aviso no ponto de coleta; registro do consentimento |
| **NT 23/2025/CON1/CGN/ANPD** (21–26/11/2025) | Consolidação de 1.594 contribuições (88 participantes, 18 perguntas) | LIDO-FONTE | **NÃO é posição da ANPD** ("Tomada de Subsídios não representa o posicionamento final", art. 18 §1º Portaria 16/2021). Mostra convergências/divergências e serve de insumo à futura norma (Item 5 da Agenda Regulatória 2025–26) | Usar as convergências como alvo de projeto, não como obrigação legal |
| **NT 4/2026/CPDP/CGF/SFI/ANPD** (fiscalização SEED-PR) | Ato de fiscalização, **vinculado a um caso** | LIDO-FONTE | Propõe suspensão imediata do FR de crianças/adolescentes na rede estadual do PR. Condutas apontadas: (1) sem hipótese legal adequada (art. 11) e **duas hipóteses para a mesma finalidade** ferem boa-fé/transparência; (2) tratamento desnecessário/desproporcional (art. 6º III) havendo meio menos invasivo; (3) RIPD insuficiente, última versão de 2021, sem revisão periódica, sem prova de eficácia dos controles, de supervisão do fornecedor e de não-discriminação do algoritmo (arts. 6º VII/VIII/X, 49); (4) sem melhor interesse (art. 14); (5) obstrução à fiscalização | **Uma única base legal por finalidade**, escolhida antes da coleta; RIPD revisável com data/versão; prova de necessidade (alternativas avaliadas) |
| NT 4/2026 sobre **hash/template** (§§5.61–5.65) | Entendimento da ANPD no caso | LIDO-FONTE | Hash/template biométrico **não descaracteriza** dado pessoal nem biométrico se ainda distingue/autentica o titular ou vincula bases; exige análise de reidentificação | **Não rotular template como "anonimizado"**; tratar como dado sensível, cifrado, com revisão periódica |
| Res. CD/ANPD 15/2024 (incidentes) | Regulamento | LIDO-RESUMO | Comunicação à ANPD em **3 dias úteis** do conhecimento; complementação em 20 dias úteis; prazo em dobro para pequeno porte (Res. 2/2022) | Módulo de incidentes: relógio de 3 dias úteis + evidência preservada |
| Res. CD/ANPD 2/2022 (pequeno porte), 18/2024 (encarregado), 19/2024 (transf. internacional) | Regulamento | Ver `07` | — | Campo de encarregado por tenant; região de hospedagem |
| Guia RIPD ANPD / modelo (v1.0, 31/07/2026, Gov Digital) | Orientação | SECUNDÁRIO (link) | Modelo e guia disponíveis | Gerar rascunho de RIPD por tenant (não substitui o do controlador) |
| Tomada de Subsídios "alto risco" / Guia de alto risco | Em elaboração | SECUNDÁRIO | Ainda não final | Reverificar |
| **Norma final de biometria** | Regulamento futuro | **NÃO localizada** | ANPD declara intenção de concluir em 2026 | **Reverificar antes de qualquer release da Fase 7** |

### Convergências da NT 23/2025 relevantes a controle de acesso (alvos de projeto)
1. **Transparência ativa**: aviso visível no ponto de coleta (placa, QR) com finalidade, hipótese legal, tipo de dado, **prazo de retenção**, critérios de descarte, segurança, compartilhamento, direitos, **encarregado e canal**; riscos e alternativas informados.
2. **Consentimento (quando usado)**: livre, específico, destacado, informado, inequívoco, ação afirmativa sem pré-seleção, **por finalidade**, revogável, **registrado de forma segura e auditável**; informar se a coleta é obrigatória/facultativa e as consequências da recusa. Consenso de que **não é adequado com assimetria de poder** (ex.: empregador) e quando a recusa inviabiliza obrigação legal; divergência sobre hierarquia entre bases.
3. **Alternativa não biométrica sempre** (senha, PIN, cartão, token, QR) para acessibilidade/não discriminação; **recusa não pode excluir do serviço principal**.
4. **Necessidade/proporcionalidade**: biometria só quando indispensável e sem alternativa igualmente eficaz; risco concreto demonstrado; **RIPD prévio**. Corrente significativa vê FR em controle de acesso de academias/condomínios como não recomendável quando há meio menos intrusivo (divergência: proibição absoluta vs. caso a caso).
5. **Segurança**: AES-256 ou superior em repouso e trânsito; chaves em ambiente seguro/HSM; MFA + RBAC; **template em vez de imagem bruta** (ou proibir armazenar bruto); segregação de rede/base; logs rastreáveis de todas as operações; auditorias internas e externas; SAST/DAST, pentest, monitoramento contínuo/SIEM; anonimização/pseudonimização; referências biométricas renováveis (irreversibilidade, revogabilidade, não interoperabilidade — ISO/IEC 24745).
6. **Retenção/descarte**: política clara, prazo limitado à finalidade, descarte seguro (método e critério), eliminação ao fim do tratamento; titular que era incapaz e se torna capaz deve decidir de novo.
7. **Anti-spoofing/acurácia**: liveness e anti-spoofing; métricas de erro (FAR/FRR), avaliação por NIST e **ISO/IEC 30107-3** citadas; viés e desempenho por população.
8. **Menores**: informação clara ao responsável, RIPD específico, melhor interesse; contextos escolares e de saúde apontados como inadequados para FR.

---

## 2. Segurança privada — Lei 14.967/2024 e regulamentação

| Item | Evidência | Achado |
|---|---|---|
| Lei 14.967/2024 (Estatuto da Segurança Privada) | LIDO-RESUMO (Câmara) — conferir literal | Art. 5º: rol de serviços inclui **VI – monitoramento de sistemas eletrônicos de segurança** e vigilância patrimonial (§4º abrange "controle de acesso e permanência de pessoas e veículos"); **XII – controle de acesso em portos e aeroportos**. Art. 7º: monitoramento compreende projeto, **locação, comercialização, instalação e manutenção** de equipamentos e assistência técnica. Art. 25: serviço orgânico de pessoa jurídica/condomínio em proveito próprio; **§5º: controle de acesso nas entradas (portaria) sem armas não é serviço orgânico**. Art. 60: adequação em até 3 anos da publicação (até 09/09/2027). Art. 46–48: multas R$ 1.000–15.000; PF multa quem **organizar, oferecer ou contratar** serviço sem observar a Lei |
| **Decreto 13.012, de 09/06/2026** (regulamenta a Lei) | LIDO-RESUMO (LegisWeb) — **a confirmar no DOU** | Regras de autorização, empresas de monitoramento eletrônico, serviços orgânicos em condomínios |
| **IN DG/PF 340, de 31/07/2026** (DOU 04/08/2026) | LIDO-RESUMO parcial (100 mil de 303 mil caracteres) | Monitoramento eletrônico exige empresa autorizada; **art. 142: observar a legislação de proteção de dados**; terceirização não afasta responsabilidade; centrais com energia ininterrupta e comunicação redundante; controle de acessos e retenção mínima de 7 dias dos dados do sistema; **monitoramento eletrônico de uso exclusivo interno de condomínio edilício não é serviço orgânico** (sem autorização PF) |

**Posição de produto (HIPÓTESE, depende de parecer jurídico):** o Zela Acesso, como software de gestão, **não opera central de monitoramento**. Risco a validar: a Arx, ou o instalador parceiro, passar a **comercializar/instalar/manter equipamentos de segurança eletrônica** (art. 7º II) ou **monitorar remotamente** pontos de clientes — isso pode enquadrar como "monitoramento de sistemas eletrônicos de segurança" e exigir autorização PF. Registrar em `19-DECISIONS` e obter parecer antes do piloto.

---

## 3. Saída de emergência / incêndio (NR-23, ABNT, Corpo de Bombeiros)

| Item | Classe | Evidência | Achado |
|---|---|---|---|
| NR-23 (Portaria MTP 2.769/2022) itens 23.3.5/23.3.5.1 | Norma regulamentadora | SECUNDÁRIO (sites que reproduzem; texto oficial **não lido**) | Nenhuma saída de emergência fechada à chave ou presa durante a jornada; permitidos dispositivos de travamento que abram facilmente por dentro |
| **NT 11/2022 CBMGO – Saídas de emergência**, itens 5.5.4.8–5.5.4.12 | Norma técnica estadual (GO) | **LIDO-FONTE** | 5.5.4.8: catraca/porta giratória exige **porta/portão adjacente** de saída; 5.5.4.9: portas com controle de acesso por automação devem ter **dispositivo de destravamento** em falta de energia, pane, defeito ou **acionamento do alarme**; 5.5.4.10 (a): com alarme de incêndio exigido, **interligação ao alarme** para permanecerem destravadas mesmo sem energia; (b) sem alarme: destravamento em todas as áreas de acesso restrito; 5.5.4.10.1: **botoeira independente por porta**, sem depender de central ou terceiro (pode liberar por curto período); 5.5.4.10.2: **não aceitas** portas com controle de acesso que restrinjam acesso do estacionamento aos halls das rotas de fuga; 5.5.4.10 trata **portaria remota**; 5.5.4.12: fechadura com chave só se abrir por dentro sem chave |
| IT 08 CBMMG (2ª ed., Portaria 26/2017) e IT 11 CBMSP, RTCBMRS 11, NT SC/DF | Norma técnica estadual | SECUNDÁRIO/parcial | Mesma lógica; **varia por UF** (a de MG cita destravamento automático em emergência) |
| ABNT NBR 9077 (saídas de emergência) e NBR 11785 (barra antipânico) | Norma técnica | Só escopo (licenciada) | Base das ITs; barra antipânico exigida por lotação/ocupação |
| PT 053/2025 CBMES – Portaria Virtual | Norma técnica estadual (ES) | SECUNDÁRIO | Existe norma de portaria virtual; relevante a portaria remota |

**Implicações:** fail-safe/fail-secure **por ponto** com justificativa registrada; entrada de **sinal de alarme de incêndio** (contato seco) que force destravamento; botoeira independente; bateria/no-break para botoeira (um catálogo cita 24 h de autonomia, SECUNDÁRIO, não é requisito confirmado); **checklist de instalação por UF** do piloto; o software nunca é o único caminho de saída. A UF do piloto ainda não foi definida → IT aplicável **pendente**.

---

## 4. Normas técnicas de sistema de controle de acesso

| Norma | Escopo | Evidência | Status para a Arx |
|---|---|---|---|
| **ABNT NBR IEC 60839-11-1:2019** | Requisitos mínimos de funcionalidade e desempenho e ensaios de sistemas e componentes de controle de acesso eletrônico (registro, identificação, controle de informação); não cobre atuadores/sensores do ponto | Escopo via loja (SECUNDÁRIO) | Referência de projeto; **não alegar certificação** |
| ABNT NBR IEC 60839-11-2 | Diretrizes de aplicação | Título (SECUNDÁRIO) | Idem |
| IEC 60839-11-5 / **SIA OSDP v2.2.2 (out/2024)** | Protocolo leitor↔controlador com Secure Channel (criptografia), supervisão; alternativa ao Wiegand sem proteção | SECUNDÁRIO | Preferir OSDP com Secure Channel no driver real (D-005 mantém "sem protocolo inventado") |
| UL 294 (ed. 8, 2023) | Segurança/desempenho de unidades de controle de acesso, 4 níveis | SECUNDÁRIO | Referência de mercado; sem obrigatoriedade no Brasil confirmada |
| EN 50133-1 | Antecessora da série IEC 60839 | Retirada em 2016 (SECUNDÁRIO) | Não usar como alvo |
| ISO/IEC 27001:2022 Anexo A 7.2 (entrada física) e A.5.15 | SGSI | SECUNDÁRIO | Mapear controles; certificação é decisão de negócio |
| ISO/IEC 30107-1/-3:2023 | PAD (anti-spoofing): conceitos e avaliação | Escopo (SECUNDÁRIO) | Liveness só declarado se o provider tiver relatório PAD |
| ISO/IEC 29794-5:2025 | Qualidade de imagem facial | Escopo (SECUNDÁRIO) | Gate de qualidade no enrolamento |
| ISO/IEC 24745, 19792, 19794-5, 27701 | Proteção de template, avaliação de segurança, formatos, privacidade | Citadas na NT 23; texto não lido | Template renovável/revogável |
| ABNT NBR 9050:2020 + Lei 13.146/2015 (LBI) + Lei 10.098/2000 | Acessibilidade; manoplas/acionadores entre 0,80 m e 1,10 m (SECUNDÁRIO) | Parcial | Alternativa à biometria; campo de acessibilidade por ponto; instalação do hardware |
| Anatel Res. 740/2020 e Ato 77/2021 | Cibersegurança / homologação de equipamentos de telecom (Wi-Fi, rádio, rede) | SECUNDÁRIO | Verificar homologação **dos equipamentos que usam rádio/rede** ofertados; aplicabilidade a controladores específicos **não confirmada** |
| Inmetro | Certificação compulsória por categoria de produto | SECUNDÁRIO | Categoria aplicável a fontes/fechaduras **não confirmada** |

---

## 5. Contexto internacional (referência, sem vigência no Brasil)
- **UE – AI Act**: verificação biométrica (1:1) para confirmar identidade fica **fora** da categoria de alto risco de identificação biométrica remota (SECUNDÁRIO, Comissão Europeia); identificação 1:N remota é alto risco. Útil como critério de projeto: preferir **verificação 1:1** (credencial + biometria) a identificação 1:N.
- **PL 2338/2023 (IA no Brasil)**: aprovado no Senado (10/12/2024), na Câmara aguardando comissão especial (SECUNDÁRIO, posição ~mar/2026). **Não é lei.**
- **ECA Digital (Lei 15.211/2025)**: aplicabilidade a controle físico não confirmada (ver `07`).

## 6. Trabalhista / condomínio (SECUNDÁRIO – validação jurídica)
- Em relação de emprego, o consentimento é frágil pela assimetria; doutrina recomenda outra base (obrigação legal/contrato) quando cabível. Alinha-se à convergência da NT 23.
- Condomínio: decisão de assembleia **não dispensa** salvaguardas LGPD; deve haver alternativa de acesso e política escrita de armazenamento/descarte (fontes não oficiais). Produto: **perfil por tenant** (condomínio/empresa/escola) com base legal e alternativas configuráveis.

---

## 7. Checklist de validação do Zela Acesso (a gerar evidência)

| # | Exigência | Origem | Estado |
|---|---|---|---|
| 1 | Uma base legal por finalidade, definida antes da coleta | NT 4/2026 | PENDENTE (7C) |
| 2 | Consentimento (se usado) por finalidade, revogável, auditável, com opção de recusa sem prejuízo | LGPD 11 I; NT 23 | PENDENTE (7C) |
| 3 | Alternativa não biométrica por ponto/pessoa | NT 23 / Radar | PARCIAL (credenciais múltiplas já existem) |
| 4 | Aviso no ponto de coleta + canal do encarregado | NT 23 | PENDENTE |
| 5 | Política de retenção/eliminação por tenant, com descarte e revogação | NT 23 | PENDENTE (7C) |
| 6 | Template cifrado, sem imagem bruta persistida, sem log de biometria | NT 23; CLAUDE.md | PARCIAL (verificar 7A/7B) |
| 7 | RIPD por tenant, versionado, com data e revisão periódica | NT 4/2026 | PENDENTE |
| 8 | Medidas de acurácia/viés/liveness documentadas pelo provider | NT 23; ISO 30107-3 | PENDENTE (benchmark, `19-DECISIONS`) |
| 9 | Biometria de menores desligada por padrão | Art. 14; NT 4/2026 | PENDENTE (7C) |
| 10 | Incidente: relógio de 3 dias úteis | Res. 15/2024 | PARCIAL (módulo 6) |
| 11 | Entrada de alarme de incêndio e fail-safe/secure por ponto, botoeira independente | CBM (ex.: NT 11/2022 GO) | PENDENTE (Fase 8) |
| 12 | Parecer jurídico sobre Lei 14.967/Decreto 13.012/IN 340 | Lei 14.967 | PENDENTE |
| 13 | ITs do CBM da UF do piloto | CBM | PENDENTE |
| 14 | Reverificar norma final de biometria da ANPD | Agenda 2025–26 | PENDENTE |
