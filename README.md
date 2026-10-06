# Zela Acesso

SaaS multi-tenant de controle de acesso físico (Arx Tecnologia). Decisão determinística + evidência auditável.

Estado e próximos passos: [docs/ZELA_ACESSO_STATUS.md](docs/ZELA_ACESSO_STATUS.md). Ambiente local isolado: [docs/ZELA_ACESSO_LOCAL_ENV.md](docs/ZELA_ACESSO_LOCAL_ENV.md).

## Requisitos
Node 24 (`.nvmrc`), pnpm 10, Docker, Supabase CLI.

## Começando
```
pnpm install
pnpm db:start && pnpm db:reset && pnpm db:seed
node scripts/write-web-env.mjs
pnpm --filter @zela/web dev     # http://127.0.0.1:55173
```

## Verificação
```
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
pnpm db:test && pnpm rbac:drift
pnpm build && pnpm check:bundle
pnpm e2e
```

Não use este repositório com credenciais ou bancos de outros projetos.
