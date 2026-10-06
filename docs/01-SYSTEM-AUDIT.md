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
- Bloqueio SSH (`No ED25519 host key is known for github.com`) resolvido em 2026-10-06 com `git config --global url."https://github.com/".insteadOf` (git@github.com: e ssh://git@github.com/).
- Instalados em `--scope project` (`.claude/settings.json`): `skill-security-scan` 1.1.0, `adversarial-verify` 1.0.1, `context-warden` 0.1.0.
- Revisão manual antes da instalação de adversarial-verify e context-warden (SKILL.md, hooks, plugin.json; sem rede, sem acesso a segredos, sem comandos perigosos): veredito ALLOW. O skill-security-scan foi lido manualmente (hook de 52 linhas, só `fs`), pois não pode vetar a si mesmo. Não é garantia de segurança em runtime. O commit instalado do context-warden (6c8ace0) difere do clonado (b3a99e2) só em README/NOTICE/.github.
- **NÃO instalados**: `supabase`, `postgres-best-practices`, `playwright-skill`, `security-audit`. Não existem no marketplace `Zavelinski/claude-code-skills` (35 plugins verificados). A origem precisa ser definida; nada será instalado sem scan prévio.
- Plugins pré-existentes: stitch-* (desabilitados), irrelevantes ao projeto.
- Ação manual mínima: confirmar a chave de host do github.com (comparar fingerprint com https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints) e adicioná-la ao `known_hosts`, ou configurar o git para usar HTTPS para github.com.

## Pendências da Fase 0
Requisitos, domínio/ERD, arquitetura, matriz regulatória (fontes oficiais), threat model, plano de testes, roadmap, decisões, CLAUDE.md.
