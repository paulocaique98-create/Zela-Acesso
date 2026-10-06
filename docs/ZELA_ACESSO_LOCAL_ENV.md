# Ambiente local — Zela Acesso

Isolado do Zela Escola (`Projeto_Zela`), que **não deve ser tocado**.

## Identificação (confirmar antes de qualquer comando destrutivo)

| Item | Zela Acesso | Zela Escola (protegido) |
|---|---|---|
| `project_id` | `zela-acesso-local` | `Projeto_Zela` |
| Containers | `supabase_*_zela-acesso-local` | `supabase_*_Projeto_Zela` |
| Portas | API 55321, DB 55322, Studio 55323, e-mail de teste 55324, shadow 55320, web 55173 | padrão (543xx) |

## Comandos (sempre via wrapper)

`scripts/supabase-local.mjs` recusa operar se `project_id` ≠ `zela-acesso-local`, nunca usa `--linked`, e antes de `reset`/`stop` confirma que existem containers `*_zela-acesso-local`.

```
pnpm db:start     # sobe a stack (sem imgproxy/edge-runtime nesta fase)
pnpm db:reset     # recria SOMENTE o banco local do Zela Acesso e aplica migrations
pnpm db:test      # pgTAP (supabase/tests/database)
pnpm db:seed      # seed sintético idempotente (9 usuários, 2 tenants)
pnpm rbac:drift   # compara matriz RBAC do código com a do banco
node scripts/write-web-env.mjs   # gera apps/web/.env.local (só chave pública)
pnpm --filter @zela/web dev      # http://127.0.0.1:55173
pnpm e2e                         # Playwright (usa .playwright-browsers local)
```

Para os navegadores do Playwright, `PLAYWRIGHT_BROWSERS_PATH=./.playwright-browsers` isola o download e evita que o instalador mexa nos de outros projetos.

## Usuários sintéticos (somente banco local)

Senha de desenvolvimento: `Zela-Dev-Local-1234`. E-mails `*@example.test`: `alfa.dono`, `alfa.admin`, `alfa.seguranca`, `alfa.recepcao`, `alfa.visualizador`, `alfa.sede` (escopo só no site "Sede"), `beta.dono`, `plataforma.dono`, `plataforma.suporte`.

## Regras

- Nunca `supabase link`, `db push`, `functions deploy`, `secrets set`, `db reset --linked`.
- Nunca copiar `.env` ou chaves do Zela Escola. As chaves exibidas por `supabase status` são as padrão do Supabase local (públicas na documentação) e não valem fora desta máquina.
- `.env.local` e `.playwright-browsers/` estão no `.gitignore`.
- Cadastro público está desligado (`[auth] enable_signup = false`). Usuários entram por convite ou pelo seed.
