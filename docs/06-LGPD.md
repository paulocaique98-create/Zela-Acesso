# 06 — LGPD (núcleo de privacidade)

Estado: Fase 9A (2026-10-07). **Não é parecer jurídico.** Itens marcados *validação jurídica* dependem do dono/advogado.

## O que existe (IMPLEMENTADO e TESTADO — pgTAP `21_phase9a_lgpd_core`)
| Tabela | Função | Escrita por |
|---|---|---|
| `retention_policy` | prazo de retenção declarado por organização e categoria (`access_events`, `visits`, `people`, `incidents`, `audit_log`) | `set_retention_policy` |
| `data_subject_request` | pedidos do titular (LGPD art. 18): confirmação, acesso, correção, anonimização/eliminação, portabilidade, informação sobre compartilhamento, revogação, revisão de decisão automatizada | `open_data_subject_request`, `update_data_subject_request` |
| `consent_record` | consentimento/ciência geral por finalidade, append-only (revogar = novo registro) | `record_consent` |

Biometria mantém tabelas próprias (Fase 7C, D-019). Permissões: `privacy:read` (owner, admin, RH, auditor) e `privacy:manage` (owner, admin). Todas as escritas são auditadas só com ids e códigos, sem nome nem texto livre.

## Regras
- **Nenhum prazo padrão é semeado.** Cada prazo exige o fundamento e a referência do parecer jurídico (`legal_opinion_ref`).
- Pedido: prazo de 15 dias corridos como padrão (art. 19, II) — *validação jurídica*. Dados de origem imutáveis; encerrado não reabre; nunca apagado; resolução obrigatória e sem dados pessoais.
- Consentimento: imutável; método `system` não registra concessão manual.

## NÃO IMPLEMENTADO / PENDENTE
- Nada **executa** a retenção (sem rotina de eliminação/anonimização de eventos, visitas, pessoas) nem atende o pedido automaticamente (exportação de dados, eliminação). Hoje é registro e controle de prazo.
- Sem telas (UI) para as três tabelas; sem alerta de pedido vencido.
- Sem aviso de privacidade versionado em documento; `notice_version` é só um rótulo.
- Base legal por finalidade, papel de controlador/operador entre Arx e cliente, encarregado e RIPD geral: *validação jurídica*.
