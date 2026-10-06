# 01 — Auditoria do Sistema (FASE 0)

Data: 2026-10-06 · Status: parcial (descoberta de ambiente concluída; pesquisa regulatória pendente)

## Repositório
- Pasta do projeto: `C:\Users\User\Desktop\Arx Tecnologia\Zela Acesso` — estava **vazia** (sem código, sem backup anterior).
- O git ativo ao abrir a sessão era o da **home** (`C:/Users/User`, remote `Painel-SDR`). Risco: commits no repositório errado.
- Ação: `git init -b main` local nesta pasta, sem remote. Nenhum remote configurado ainda.

## Ferramentas
| Item | Versão |
|---|---|
| Node | v24.15.0 |
| npm / pnpm | 11.15.0 / 10.33.2 |
| bun | ausente (não necessário) |
| git | 2.55.0 |
| Docker | 29.8.1, contexto `desktop-linux`, daemon acessível |
| Supabase CLI (global) | 2.109.1 |
| Claude Code | 2.1.126 |

## Coexistência com o Zela Escola (PROTEGIDO)
- Stack local `Projeto_Zela` em execução (12 containers, imagens Supabase; Postgres 17.6.1.141). Porta 54440 em uso.
- `supabase_edge_runtime_Projeto_Zela` está Exited (137) e `supabase_vector_Projeto_Zela` em restart loop: **problema pré-existente do Zela Escola, fora de escopo, não tocar**.
- CLI 2.109.1 < 2.119.0 → modo `supabase stack` indisponível. Estratégia: `project_id = "zela-acesso-local"` + faixa de portas própria (55xxx), configurada explicitamente em `config.toml`. Containers são nomeados pelo `project_id`, então não colidem.
- Proibido: `supabase stop`, `docker compose down`, `docker system prune`, remoção de volumes.

## Skills / plugins (Seção 0.1)
- Marketplace `Zavelinski/claude-code-skills` adicionada (escopo user).
- `skill-security-scan` **NÃO instalada**: falha de clone SSH (`No ED25519 host key is known for github.com`).
- Demais plugins (adversarial-verify, context-warden, supabase, postgres-best-practices, playwright-skill, security-audit) **NÃO instalados** — dependem do scan prévio e do mesmo mecanismo de clone.
- Plugins pré-existentes: stitch-* (desabilitados), irrelevantes ao projeto.
- Ação manual mínima: confirmar a chave de host do github.com (comparar fingerprint com https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints) e adicioná-la ao `known_hosts`, ou configurar o git para usar HTTPS para github.com.

## Pendências da Fase 0
Requisitos, domínio/ERD, arquitetura, matriz regulatória (fontes oficiais), threat model, plano de testes, roadmap, decisões, CLAUDE.md.
