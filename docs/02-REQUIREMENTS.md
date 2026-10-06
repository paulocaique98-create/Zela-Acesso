# 02 — Requisitos (resumo executável)

Detalhe completo: Prompt-Mestre, seções 10–58. Este arquivo só lista o que é verificável.

## Funcionais (MVP)
RF-01 multi-tenant com hierarquia site/prédio/andar/zona · RF-02 RBAC recurso+ação+escopo · RF-03 pessoas e grupos · RF-04 credenciais múltiplas (CARD/PIN/QR; FACE depois) · RF-05 pontos de acesso com comportamento offline/emergência · RF-06 horários, feriados, políticas · RF-07 `evaluateAccess` com códigos de motivo · RF-08 anti-passback soft/hard · RF-09 Access Evidence por tentativa · RF-10 eventos append-only + auditoria · RF-11 visitantes (convite, QR, check-in/out, zonas) · RF-12 alertas básicos (porta aberta/forçada, offline, negações repetidas) · RF-13 dashboard e presença · RF-14 Edge Agent offline com sync idempotente · RF-15 pelo menos um caminho de hardware real · RF-16 API + webhooks assinados.

## Não funcionais
RNF-01 RLS em toda tabela exposta, testada cross-tenant · RNF-02 sem secrets no frontend · RNF-03 Storage privado · RNF-04 MFA para admins em produção · RNF-05 decisão local < 500 ms (alvo, a medir) · RNF-06 paginação/índices; sem `select *` · RNF-07 logs estruturados com correlation_id, sem PIN/token/biometria · RNF-08 UI acessível (teclado, contraste) · RNF-09 migrations reproduzíveis e seed 100% sintético · RNF-10 branding centralizado.

## Fora do MVP
IA generativa na decisão, LPR avançado, VMS, central de monitoramento, ponto/folha, dezenas de fabricantes.
