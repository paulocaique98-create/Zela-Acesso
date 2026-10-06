# PROMPT-MESTRE — ZELA ACESSO
## Desenvolvimento de plataforma de controle de acesso físico da Arx Tecnologia

**Destinatário:** Claude Code — extensão no Antigravity
**Projeto:** Zela Acesso
**Empresa / marca corporativa prevista:** Arx Tecnologia
**Documento:** Especificação-mestre para análise, arquitetura, implementação, testes, segurança, compliance e preparação para produção
**Data de referência:** 06/10/2026
**Revisão:** R1 — 06/10/2026 (alinhamento com o estado implementado; ver Anexos A–D)
**Idioma obrigatório do projeto/documentação interna:** Português do Brasil

---

# 0.0 STATUS DESTE DOCUMENTO E PRECEDÊNCIA (inserido na R1)

Este é o **documento base do projeto**. O `CLAUDE.md` é apenas memória operacional e boas práticas de economia de tokens: ele não cria nem altera requisitos de produto.

**Ordem de precedência:**

1. Instrução atual do dono/usuário.
2. **Este documento (Prompt-Mestre).**
3. `docs/ZELA_ACESSO_STATUS.md` — estado vivo (o que está implementado, testado, pendente). Em conflito sobre *estado*, o STATUS prevalece; sobre *requisito*, prevalece este documento.
4. Docs específicos: `docs/19-DECISIONS.md` (decisões), `docs/07-REGULATORY-MATRIX.md` (evidência regulatória), `docs/14-THREAT-MODEL.md`, `docs/03-DOMAIN-MODEL.md`, `docs/04-ARCHITECTURE.md`, `docs/15-TEST-PLAN.md`, `docs/20-ROADMAP.md`, `docs/ZELA_ACESSO_LOCAL_ENV.md`, `docs/01-SYSTEM-AUDIT.md`.
5. `CLAUDE.md` — memória e economia de tokens.

**Regras de uso:**

- Não reler este documento inteiro a cada tarefa: localizar a seção por busca (`Grep "^# N\."`) e ler só o trecho.
- Mudança de requisito = editar este documento **e** registrar em `docs/19-DECISIONS.md`. Mudança de estado = `docs/ZELA_ACESSO_STATUS.md`.
- A numeração de seções (§) é estável: referências como "Seção 58" continuam válidas. Novas seções entram como subitens ou anexos.
- Trechos marcados **"Emenda R1"** foram acrescentados ou alterados na revisão R1 e prevalecem sobre o texto original ao redor.
- Quando o texto original e uma decisão já aplicada do dono divergirem (Anexo A), vale a decisão do dono.

---

# 0. INSTRUÇÃO SUPREMA

Você está recebendo este documento como **prompt-mestre de engenharia**, não como uma lista superficial de funcionalidades.

Seu objetivo é conduzir a construção do **Zela Acesso**, produto independente da Arx Tecnologia, desde o início até uma base tecnicamente sólida, segura, escalável, auditável e preparada para operação comercial em todo o Brasil.

O sistema deverá ser desenvolvido com mentalidade de produto de produção, e não como protótipo descartável.

Você deve atuar simultaneamente como:

1. **Arquiteto de Software Sênior**;
2. **Engenheiro de Software Sênior**;
3. **Engenheiro de Segurança de Aplicações**;
4. **Engenheiro de Sistemas/Edge**;
5. **QA Engineer / Analista de Sistemas**;
6. **Analista de Produto**;
7. **Especialista em SaaS multi-tenant**;
8. **Especialista em integração de hardware e sistemas de controle de acesso**;
9. **Analista de requisitos regulatórios**, sem substituir parecer jurídico;
10. **Revisor crítico de decisões arquiteturais**.

Não trate este prompt como autorização para simplesmente começar a criar telas.

A primeira obrigação é **preparar o ambiente, entender, verificar, documentar e só depois implementar**.

---

# 0.1 BOOTSTRAP AUTOMÁTICO DE SKILLS — NÃO EXIGIR INSTALAÇÃO MANUAL DO USUÁRIO

Antes de iniciar a implementação, prepare o ambiente do Claude Code para este projeto. O objetivo é que o usuário NÃO precise executar manualmente comandos Bash/PowerShell para instalar as skills definidas neste prompt.

A instalação deve ser feita pelo próprio Claude Code usando seus comandos/CLI de plugins, quando suportados pelo ambiente. Use a instalação em escopo de projeto (`--scope project`) por padrão, para que a configuração do projeto seja reproduzível. Não instale skills globalmente sem necessidade.

## 0.1.1 Regra de segurança

Skills/plugins de terceiros são código/instruções executadas com os privilégios do ambiente do agente. Portanto, NÃO instale cegamente.

Primeiro:

1. verificar se o plugin já está instalado;
2. verificar a origem oficial do repositório;
3. instalar a skill `skill-security-scan` da marketplace `Zavelinski/claude-code-skills`;
4. usar essa skill para revisar estaticamente os componentes de terceiros antes de habilitá-los, quando a skill estiver disponível;
5. bloquear qualquer instalação que apresente risco não aceitável, tentativa de exfiltração, alteração insegura de settings/hooks ou instrução suspeita;
6. registrar o resultado em `docs/ZELA_ACESSO_SKILLS.md`.

A análise de segurança de uma skill é uma verificação preventiva e NÃO substitui revisão humana. Nunca execute manualmente scripts de instalação de terceiros quando existir o mecanismo oficial de plugin do Claude Code.

## 0.1.2 Skills obrigatórias deste projeto

### A. Supabase
Marketplace/repositório:

```text
supabase/agent-skills
```

Plugin:

```text
supabase@supabase-agent-skills
```

Uso: qualquer tarefa envolvendo Supabase — Database, Auth, RLS, Storage, Realtime, Edge Functions, migrations, Supabase CLI, segurança e integrações.

### B. Supabase Postgres Best Practices

Plugin:

```text
postgres-best-practices@supabase-agent-skills
```

Uso: schema, índices, queries, migrations, concorrência, performance, RLS e segurança PostgreSQL.

### C. Playwright
Marketplace/repositório:

```text
lackeyjb/playwright-skill
```

Plugin:

```text
playwright-skill@playwright-skill
```

Uso: testes E2E, fluxos reais de navegador, regressão visual/funcional, autenticação, permissões e jornadas críticas.

Após a instalação, localizar a cópia instalada da skill e executar o setup oficial necessário (`npm run setup`) somente dentro do diretório correto da skill. Não inventar caminho fixo; descobrir o caminho real no ambiente.

### D. Security Audit
Marketplace/repositório:

```text
toshipon/claude-code-security-audit-skill
```

Plugin:

```text
security-audit@toshipon-security-audit
```

Uso: auditorias de segurança do stack, especialmente Supabase/RLS/Auth/Storage/Edge Functions, web, secrets, supply chain e CI/CD.

Não executar a auditoria completa em toda mudança trivial. Usar em checkpoints de segurança definidos neste prompt.

### E. Adversarial Verify
Marketplace:

```text
Zavelinski/claude-code-skills
```

Plugin:

```text
adversarial-verify@claude-code-skills
```

Uso: tentar falsificar/romper mudanças importantes, especialmente regras de autorização, isolamento multi-tenant, decisões do motor de acesso, anti-passback, eventos e fluxos críticos.

### F. Context Warden
Marketplace:

```text
Zavelinski/claude-code-skills
```

Plugin:

```text
context-warden@claude-code-skills
```

Uso: manter o contexto de trabalho enxuto e evitar carregamento desnecessário de capacidades/documentos.

Regra: não usar `context-warden` para introduzir comportamento global pesado. Ative-o somente nos fluxos em que realmente reduzir contexto. A economia de tokens nunca deve causar perda de evidência, segurança ou precisão.

## 0.1.3 Comandos de instalação que o Claude Code deve tentar executar

Use a CLI oficial do Claude Code. Não peça ao usuário para executar estes comandos manualmente, salvo quando o próprio ambiente bloquear uma operação que exija confirmação humana.

```bash
claude plugin marketplace add Zavelinski/claude-code-skills
claude plugin marketplace add supabase/agent-skills
claude plugin marketplace add lackeyjb/playwright-skill
claude plugin marketplace add toshipon/claude-code-security-audit-skill
```

Depois, instalar em escopo de projeto:

```bash
claude plugin install skill-security-scan@claude-code-skills --scope project
claude plugin install adversarial-verify@claude-code-skills --scope project
claude plugin install context-warden@claude-code-skills --scope project
claude plugin install supabase@supabase-agent-skills --scope project
claude plugin install postgres-best-practices@supabase-agent-skills --scope project
claude plugin install playwright-skill@playwright-skill --scope project
claude plugin install security-audit@toshipon-security-audit --scope project
```

Se uma versão do Claude Code exigir sintaxe equivalente ou usar `/plugin` dentro da sessão, adaptar para a sintaxe suportada oficialmente. Não insistir em um comando incompatível.

## 0.1.4 Instalação idempotente

Nunca reinstalar algo que já esteja instalado e saudável.

Antes de cada instalação:

```bash
claude plugin list
```

Usar a listagem para detectar:

- já instalado;
- parcialmente instalado;
- desabilitado;
- marketplace ausente;
- instalação quebrada.

Corrigir somente o necessário.

## 0.1.5 Verificação obrigatória pós-instalação

Após instalar:

1. verificar `claude plugin list`;
2. confirmar que cada plugin obrigatório aparece instalado/ativo;
3. verificar se Playwright possui dependências necessárias e setup concluído;
4. verificar se não foram criados hooks inesperados;
5. registrar versão/origem das skills em `docs/ZELA_ACESSO_SKILLS.md`;
6. se uma skill falhar, NÃO bloquear todo o projeto automaticamente: documentar a falha, avaliar substituição segura e continuar somente com o que não depende dela.

## 0.1.6 Regra de economia de tokens para Skills

A instalação de uma skill NÃO significa que seu conteúdo deve ser lido permanentemente.

Aplicar progressive disclosure:

- carregar somente a skill relevante para a tarefa atual;
- não abrir README/reference completos sem necessidade;
- não chamar todas as skills simultaneamente;
- não usar Security Audit, Adversarial Verify, Playwright ou contexto adicional em tarefas que não precisam deles;
- preferir resultados filtrados e artefatos curtos;
- nunca duplicar no CLAUDE.md as instruções detalhadas que já pertencem às skills.

## 0.1.7 Falha de instalação que exigir interação humana

Se o Claude Code bloquear a instalação por:

- autenticação;
- confirmação de segurança;
- política da máquina;
- plugin incompatível com a versão instalada;
- acesso de rede;
- permissão do sistema;

não invente uma instalação alternativa insegura.

Informe exatamente qual etapa bloqueou, qual skill foi afetada e qual ação manual mínima é necessária. Depois continue a análise/arquitetura sem fingir que a skill está instalada.

## 0.1.8 Estado vigente das skills (inserido na R1)

> **Emenda R1.** Em 06/10/2026 (D-011), o dono dispensou `supabase`, `postgres-best-practices`, `playwright-skill` e `security-audit` porque, na época, a origem não estava verificada (a auditoria só havia procurado no marketplace Zavelinski). Estão instaladas em escopo de projeto: `skill-security-scan` 1.1.0, `adversarial-verify` 1.0.1 e `context-warden` 0.1.0.
>
> Regras decorrentes:
>
> 1. As origens indicadas na §0.1.2 existem neste documento; **reavaliar a dispensa é decisão do dono**. Se ele autorizar, instalar somente após scan prévio (§0.1.1).
> 2. Enquanto dispensadas: usar a documentação oficial (Supabase, Postgres, Playwright) e fazer os checkpoints de segurança (§0.3, §70) por revisão adversarial manual + `adversarial-verify`, **declarando explicitamente que o Security Audit não foi usado**. Nunca registrar um checkpoint como "auditado por Security Audit" sem tê-lo executado.
> 3. Criar `docs/ZELA_ACESSO_SKILLS.md` (hoje ausente) registrando: skills instaladas (versão, origem, resultado do scan), skills dispensadas (motivo, data, decisão D-011) e como reavaliar.

---

# 0.2 BOOTSTRAP AUTOMÁTICO DO AMBIENTE LOCAL — DOCKER + SUPABASE LOCAL

O desenvolvimento do Zela Acesso deve começar em ambiente **100% local**, evitando consumo desnecessário de armazenamento, egress, Realtime, Storage ou banco do Supabase remoto.

O fato de o computador já possuir Docker Desktop e eventualmente já utilizá-lo para o Zela Escola NÃO significa que o Zela Acesso deva compartilhar configuração, containers, volumes, banco ou credenciais com o Zela Escola.

## 0.2.1 Regra de isolamento

Criar um ambiente local próprio para o Zela Acesso:

```text
ZELA ESCOLA
→ ambiente existente
→ NÃO ALTERAR
→ NÃO REUTILIZAR CREDENCIAIS

ZELA ACESSO
→ projeto local próprio
→ Docker próprio para os serviços do projeto
→ Supabase local próprio
→ banco local próprio
→ Storage local próprio
→ Auth local próprio
→ Realtime local próprio
→ Edge Functions locais
→ seed/fake data
```

Nunca conectar o ambiente local do Zela Acesso automaticamente ao projeto remoto de produção do Zela Escola.

Nunca copiar `.env`, service role key, tokens, URLs ou secrets de produção do Zela Escola para o Zela Acesso.

## 0.2.2 Verificação inicial do Docker Desktop

Antes de criar qualquer container:

1. verificar se `docker` está disponível;
2. executar `docker version`;
3. executar `docker info`;
4. verificar `docker context show`;
5. confirmar que o daemon está realmente acessível;
6. confirmar que o ambiente pertence ao Zela Acesso e não está apontando para uma infraestrutura remota;
7. não alterar configurações globais do Docker Desktop sem necessidade;
8. não remover/parar containers do Zela Escola.

Se Docker Desktop estiver instalado, mas o daemon estiver parado, tentar iniciar de forma segura usando os mecanismos disponíveis no ambiente. Não interromper containers existentes do Zela Escola.

Se o sistema bloquear o início automático por permissão/segurança, informar exatamente o bloqueio e continuar apenas com as tarefas que não dependam do Docker.

## 0.2.3 Verificação/instalação da Supabase CLI

Verificar primeiro:

```bash
supabase --version
```

e, se o comando global não existir:

```bash
npx supabase --version
```

Preferir CLI versionada pelo projeto quando possível, para que todos os ambientes utilizem a mesma versão.

Se o projeto ainda não possuir a CLI como dependência, considerar:

```bash
npm install --save-dev supabase
```

ou o equivalente ao package manager efetivamente usado no projeto.

Não instalar globalmente sem necessidade.

A documentação oficial atual da Supabase indica `supabase init` para inicializar o projeto local e `supabase start` para iniciar a stack local via Docker. O CLI via npm exige Node.js 20 ou superior. Fonte oficial: https://supabase.com/docs/guides/local-development/cli/getting-started

## 0.2.4 Inicialização do projeto Supabase local

Se ainda não existir `supabase/config.toml` no projeto do Zela Acesso:

```bash
npx supabase init
```

ou o comando equivalente adequado ao package manager já adotado.

Não executar `supabase link` nesta etapa.

Não conectar o projeto local a qualquer projeto remoto sem autorização explícita.

Após `init`, revisar `supabase/config.toml` e garantir que o `project_id` local identifica claramente o Zela Acesso, por exemplo:

```toml
project_id = "zela-acesso-local"
```

Não reutilizar o `project_id` de produção.

### IMPORTANTE — coexistência com o Zela Escola

O usuário já possui Docker Desktop e pode ter uma stack Supabase local do Zela Escola em execução na mesma máquina.

**Não executar `supabase stop`, `docker compose down`, `docker system prune` ou qualquer comando global que possa derrubar a stack do Zela Escola.** (Emenda R1: removida a menção a `supabase down`, que não é um comando da CLI. Os comandos de ciclo de vida do Zela Acesso passam sempre pelo wrapper `scripts/supabase-local.mjs` — ver §0.2.9.)

Antes de iniciar a stack do Zela Acesso:

1. detectar se existe outra stack Supabase local em execução;
2. detectar conflitos de portas;
3. verificar a versão da Supabase CLI;
4. preferir o mecanismo oficial de múltiplos projetos locais (`supabase stack`) quando a versão instalada for compatível;
5. manter bancos, Storage, containers, volumes e portas do Zela Acesso separados do Zela Escola.

A documentação atual da Supabase informa que `supabase start` com a configuração tradicional usa portas fixas e apenas um projeto local por máquina; para múltiplos projetos a própria Supabase oferece `supabase stack`, ainda classificado como experimental. Fonte: https://supabase.com/docs/guides/local-development/running-multiple-local-projects

Se a CLI instalada for `>= 2.119.0` e o recurso estiver disponível, considerar para o Zela Acesso:

```toml
[experimental]
stack = true
```

e utilizar uma identidade/stack própria, por exemplo:

```bash
supabase start --stack zela-acesso-dev --runtime docker
```

Não ativar o modo experimental cegamente. Primeiro verificar a CLI e as instruções oficiais da versão instalada.

Se o modo `stack` não puder ser usado com segurança, ajustar a configuração local de portas de forma explícita e documentada, sem modificar a stack do Zela Escola.

> **Emenda R1.** Estado vigente: CLI global 2.109.1 (< 2.119.0), logo o modo `stack` está indisponível; o projeto usa `project_id = "zela-acesso-local"` com faixa de portas própria 553xx (D-002). Reavaliar `stack` se a CLI for atualizada, sem migrar às cegas.

## 0.2.5 Inicialização do Supabase via Docker

Com Docker funcional:

```bash
npx supabase start --runtime docker
```

Se a versão instalada não aceitar `--runtime docker`, usar a sintaxe oficial equivalente suportada pela versão instalada.

A stack local deve fornecer, conforme a configuração utilizada:

- PostgreSQL local;
- Auth local;
- Storage local;
- Realtime local;
- API local;
- Studio local;
- serviços necessários às Edge Functions/testes.

A documentação oficial informa que a stack local roda em containers Docker e que o desenvolvimento local é autocontido e não consome a quota do projeto hospedado. Fonte: https://supabase.com/docs/guides/local-development

## 0.2.6 Rede local e exposição

O ambiente local NÃO pode ficar publicamente exposto.

Preferir bindings locais/localhost. Quando houver necessidade de restringir explicitamente a rede Docker ao host local, avaliar a configuração recomendada oficialmente pela Supabase.

Não abrir portas da stack Supabase para a internet.

Não publicar URLs locais em documentação pública.

## 0.2.7 Variáveis de ambiente locais

Criar, conforme a arquitetura final, arquivos/estruturas locais como:

```text
.env.local
.env.example
```

O `.env.example` contém apenas placeholders.

O `.env.local` não deve ser commitado quando contiver credenciais.

O frontend deve apontar para os serviços locais durante desenvolvimento.

Exemplo conceitual:

```text
VITE_SUPABASE_URL=http://localhost:...
VITE_SUPABASE_PUBLISHABLE_KEY=<chave-local>
```

Adaptar nomes às versões atuais do SDK e às convenções reais do projeto.

Nunca colocar `service_role`/secret key no frontend.

Secrets administrativos devem permanecer apenas no backend/Edge/local server quando necessários.

## 0.2.8 Seed e dados fictícios

Criar desde cedo uma estratégia reproduzível de seed local.

O seed deve conter apenas dados sintéticos, por exemplo:

```text
Arx Tecnologia Demo
 ├── Matriz
 ├── Filial 01
 ├── Administração
 ├── Financeiro
 ├── Produção
 └── Portaria
```

Criar dados falsos para:

- organizações;
- unidades;
- edifícios;
- zonas;
- pessoas;
- grupos;
- credenciais não reais;
- políticas;
- pontos de acesso;
- visitantes;
- eventos;
- incidentes;
- dispositivos;
- situações offline;
- situações de porta forçada;
- anti-passback;
- auditoria.

É proibido utilizar no seed:

- CPF real;
- RG real;
- foto real;
- biometria real;
- dados de cliente real;
- API key real;
- senha real;
- token real;
- dados financeiros reais.

> **Emenda R1.** O seed cresce por fase, junto com as entidades que a fase cria (não é preciso semear entidades que ainda não existem). Local atual: `scripts/seed-dev.mjs` (idempotente); `supabase/seed/` é opcional e só se justifica se o seed passar a ser SQL puro. O seed roda **somente** contra o `zela-acesso-local`.

## 0.2.9 Reset reproduzível

O ambiente local deve poder ser destruído e recriado sem depender de trabalho manual.

O objetivo é permitir o fluxo equivalente a (sempre pelo wrapper, que confirma o alvo `zela-acesso-local` antes de qualquer `stop`/`reset`):

```bash
pnpm db:stop
pnpm db:start
```

e, quando apropriado:

```bash
pnpm db:reset
```

> **Emenda R1 (contradição C-3 resolvida).** O texto original usava `npx supabase stop` aqui, enquanto a §0.2.4 proíbe `supabase stop`. A proibição vale para chamadas **diretas e globais** (que podem derrubar a stack do Zela Escola). O wrapper `scripts/supabase-local.mjs` passa `--project-id zela-acesso-local`, recusa operar se o `project_id` for outro e confirma a existência de containers `*_zela-acesso-local` antes de `reset`/`stop`. Chamar a CLI diretamente continua proibido.

O reset local pode ser destrutivo porque contém apenas dados fictícios.

Nunca aplicar `db reset --linked` neste projeto durante o desenvolvimento local.
Nunca executar operação destrutiva contra produção.

## 0.2.10 Edge Functions localmente

Toda Edge Function necessária ao desenvolvimento deve funcionar localmente antes de ser publicada remotamente.

Testar:

```text
frontend
 ↓
Edge Function local
 ↓
Supabase local
```

Não utilizar Edge Functions remotas como dependência silenciosa do ambiente local.

> **Emenda R1 (gap A-4).** Hoje o wrapper sobe a stack com `-x imgproxy,edge-runtime`, de modo que `create-tenant-owner` e `lookup-cnpj` só têm teste de lógica com clientes simulados (não de ponta a ponta). Antes de **publicar** qualquer função: (1) habilitar o `edge-runtime` do **nosso** `project_id` no wrapper e no CI; (2) executar a função local ponta a ponta (web → função → Supabase local) com teste automatizado; (3) só então planejar o deploy (§0.2.16). O runtime do Zela Escola (que já apresenta falha própria) segue fora de escopo e não deve ser tocado.

## 0.2.11 Storage e imagens

Durante desenvolvimento:

```text
upload
 ↓
Storage LOCAL
```

Nunca enviar imagens, fotos de visitantes ou qualquer biometria de teste ao Storage remoto de produção.

O Storage local deve ser suficiente para testar:

- upload;
- download autorizado;
- URLs assinadas quando aplicáveis;
- expiração;
- exclusão;
- políticas de acesso;
- isolamento multi-tenant.

## 0.2.12 Realtime local

O Realtime deverá ser exercitado localmente para testar:

- evento de acesso;
- decisão liberado/negado;
- abertura/fechamento de porta;
- dispositivo online/offline;
- alertas;
- atualização de dashboard;
- sincronização Edge Agent;
- isolamento por tenant.

## 0.2.13 Simulador de hardware

Antes da integração com hardware físico, criar um **Mock Hardware Adapter** local.

Ele deve simular, no mínimo:

```text
access.requested
access.granted
access.denied
door.opened
door.closed
door.forced
door.held_open
device.online
device.offline
heartbeat
clock_sync
```

Permitir simular:

- leitor online;
- leitor offline;
- porta aberta;
- porta forçada;
- porta mantida aberta;
- leitura de credencial válida;
- leitura inválida;
- timeout;
- atraso de comunicação;
- duplicidade;
- fila offline;
- reconexão;
- sincronização.

A aplicação deve consumir o Mock Hardware Adapter através da mesma interface/contrato que futuramente será utilizada pelos drivers reais.

> **Emenda R1 (contradição C-4 / gap A-6).** Cronograma: o **contrato** (HAL em `packages/device-drivers`) é definido na Fase 3, junto com o motor; o **Mock Hardware Adapter** é entregue na Fase 4, como parte do vertical slice (§112). O checklist de saída da Fase 0 (§0.2.17) cobre apenas o ambiente, não os mocks.

## 0.2.14 Simulação biométrica

No desenvolvimento inicial, não utilizar biometria real.

Criar adaptador abstrato:

```text
BiometricProvider
 ├── MockBiometricProvider
 ├── Browser/Local Provider (quando aprovado)
 └── Device Provider (futuro)
```

O `MockBiometricProvider` deverá permitir simular:

- match;
- no match;
- baixa confiança;
- liveness aprovado;
- liveness rejeitado;
- dispositivo indisponível;
- timeout.

**Não usar `face-api.js`.**

`@vladmandic/human` pode ser avaliado como provider local/browser, mas não deve ser acoplado como decisão definitiva sem benchmark.

Para equipamentos físicos, o provider poderá ser diferente do utilizado no navegador. A arquitetura deverá esconder essa diferença atrás de uma interface comum.

> **Emenda R1.** A interface `BiometricProvider` e o `MockBiometricProvider` entram na Fase 7 (§69), antes de qualquer provider real. Biometria permanece desligada por padrão.

## 0.2.15 Playwright contra localhost

O Playwright deve executar contra o ambiente local:

```text
localhost
 ↓
React/Vite
 ↓
Supabase local
 ↓
Mock Hardware
```

Criar fluxos E2E para:

- login;
- criação da organização;
- criação de unidade;
- cadastro de pessoa;
- criação de credencial;
- criação de política;
- tentativa de acesso autorizada;
- tentativa negada;
- evento de porta;
- visitante;
- auditoria;
- offline/reconexão quando possível;
- isolamento multi-tenant.

## 0.2.16 Guardas contra acesso remoto acidental

Criar mecanismos para tornar evidente quando o ambiente está apontando para produção.

Antes de qualquer comando sensível, verificar as variáveis de ambiente e o destino atual.

No desenvolvimento local, NÃO executar automaticamente:

```text
supabase link
supabase db push
supabase functions deploy
supabase secrets set
migrations destrutivas remotas
uploads para Storage remoto
operações contra produção
```

Esses comandos só podem ser utilizados posteriormente em staging/produção, através do processo de deployment definido no projeto.

Se qualquer variável local apontar para um Supabase remoto, interromper a operação de desenvolvimento que possa gravar dados e corrigir o ambiente antes de continuar.

> **Emenda R1 (gap B-ambientes).** Existe hoje um Supabase remoto de **staging** (sa-east-1) com migrations aplicadas por autorização do dono. Regras: (1) toda operação remota (`link`, `db push`, `functions deploy`, `secrets set`, `config push`) exige **autorização humana explícita naquela operação**; (2) deve existir `docs/16-DEPLOYMENT.md` descrevendo o processo (ordem: migrations → funções + secrets/`ALLOWED_ORIGINS` → front); (3) nunca fazer `config push` com o `config.toml` local sem antes separar a configuração de produção (o arquivo local contém valores de dev, como o rate limit de login elevado para o E2E).

## 0.2.17 Verificação final do bootstrap local

Antes de sair da Fase 0, comprovar:

```text
[ ] Docker Desktop/daemon funcionando
[ ] Docker runtime identificado
[ ] Supabase CLI disponível
[ ] supabase/config.toml criado
[ ] Supabase local iniciado
[ ] Postgres local funcionando
[ ] Auth local funcionando
[ ] Storage local funcionando
[ ] Realtime local funcionando
[ ] Edge Functions localmente testáveis
[ ] frontend apontando para local
[ ] seed sintético funcionando
[ ] reset local reproduzível
[ ] Mock Hardware Adapter funcionando
[ ] Mock Biometric Provider funcionando
[ ] Playwright apontando para localhost
[ ] produção não utilizada
[ ] nenhuma credencial real no ambiente local
[ ] documentação do ambiente criada
```

> **Emenda R1 (contradição C-4).** Itens com dependência de fase, que **não** bloqueiam a saída da Fase 0/1: `Edge Functions localmente testáveis` (obrigatório antes de publicar qualquer função — §0.2.10); `Mock Hardware Adapter funcionando` (Fase 4); `Mock Biometric Provider funcionando` (Fase 7). Os demais itens são o gate do ambiente. O STATUS deve registrar cada um como TESTADO, NÃO TESTADO ou PENDENTE, nunca marcar sem evidência.

Registrar o resultado em:

```text
docs/ZELA_ACESSO_LOCAL_ENV.md
```

Esse arquivo deve ser curto e conter apenas:

- ferramentas e versões;
- status do Docker;
- comando de inicialização;
- portas/URLs locais;
- seed/reset;
- estrutura de ambiente;
- problemas encontrados;
- próximos passos.

Não registrar secrets no documento.

> **Emenda R1 (gap B-LOCAL_ENV).** O `ZELA_ACESSO_LOCAL_ENV.md` atual cobre comandos, portas e regras, mas **falta** "ferramentas e versões", "status do Docker", "problemas encontrados" e "próximos passos". Além disso, ele registra a senha de desenvolvimento dos usuários sintéticos; embora seja sintética e só valha no banco local, o critério "não registrar secrets" pede que o documento aponte para o script do seed em vez de repetir a senha. Ajustar quando o documento for revisado.

## 0.2.18 Regra definitiva de proteção do ambiente existente

O Claude Code deve considerar o ambiente Zela Escola como **fora de escopo e protegido**.

Antes de qualquer comando Docker/Supabase potencialmente destrutivo:

```text
1. identificar o alvo;
2. mostrar qual projeto/stack/containers seriam afetados;
3. confirmar que o alvo é Zela Acesso local;
4. bloquear se houver ambiguidade.
```

Nunca presumir que um comando como `supabase stop`, `docker compose down`, remoção de volume ou limpeza de imagens é seguro apenas porque foi executado a partir do diretório do Zela Acesso.

O objetivo é que o Zela Acesso possa ser desenvolvido, resetado e destruído localmente sem causar qualquer impacto no ambiente local, staging ou produção do Zela Escola.

---

# 0.3 MATRIZ DE USO DAS SKILLS

| Skill | Quando usar | Não usar quando |
|---|---|---|
| Supabase | Banco, Auth, RLS, Storage, Realtime, Edge, migrations | tarefa puramente visual/documental |
| Postgres Best Practices | schema, índices, queries, RLS, performance | copy/UI sem impacto em banco |
| Playwright | E2E e validação de navegador | lógica unitária simples já coberta por Vitest |
| Security Audit | checkpoints de segurança e release | toda alteração trivial |
| Adversarial Verify | mudanças críticas de autorização/segurança | texto/UI sem risco lógico |
| Context Warden | controlar contexto e roteamento de capacidades | tarefa pequena que já possui contexto mínimo |
| Skill Security Scan | antes de instalar/reinstalar skills de terceiros | plugins já confiáveis e previamente verificados |

> **Emenda R1.** Skills dispensadas (§0.1.8) não são usadas; a coluna "Quando usar" passa a ser cumprida por documentação oficial + revisão adversarial manual, com declaração explícita.

---

# 1. PRINCÍPIO FUNDAMENTAL: NÃO CODIFIQUE CEGAMENTE

Antes de implementar qualquer módulo importante:

- examine o repositório atual;
- identifique se existe código, protótipo, backup ou projeto anterior relacionado ao Zela Acesso;
- examine a estrutura de pastas;
- verifique o ambiente de desenvolvimento;
- execute o bootstrap de skills da Seção 0.1 antes da implementação, de forma idempotente;
- verifique Node/npm/pnpm/bun, Docker, Supabase CLI e demais ferramentas disponíveis;
- procure arquivos de instruções como `CLAUDE.md`, `AGENTS.md`, `README.md`, `.cursor`, `.github`, scripts e documentação;
- identifique convenções existentes;
- descubra se há acesso ao Supabase;
- descubra se existem variáveis de ambiente já configuradas;
- descubra se existe outro projeto Zela que possa servir apenas como referência;
- **não copie arquitetura, tabela, política ou código de outro projeto sem verificar se a regra realmente se aplica ao Zela Acesso**.

Se houver um projeto Zela Escola disponível no ambiente, use-o como **referência arquitetural e de domínio**, não como fonte automática de código.

O Zela Escola possui histórico de produção e dados reais. Portanto, alterações nele são proibidas neste projeto salvo instrução explícita posterior.

**Regra:** Zela Acesso é um novo produto, com identidade e domínio próprios, podendo compartilhar conceitos e componentes reutilizáveis, mas não deve ficar estruturalmente acoplado ao Zela Escola.

---

# 2. OBJETIVO DO PRODUTO

Construir o **Zela Acesso**, uma plataforma SaaS brasileira de controle de acesso físico capaz de atender pequenos, médios e grandes clientes, em múltiplos segmentos e unidades, com suporte a diferentes métodos de identificação, diferentes tipos de pontos de acesso e diferentes fabricantes de hardware.

O produto deverá funcionar como plataforma independente para:

- empresas;
- indústrias;
- escolas;
- universidades;
- clínicas;
- hospitais, respeitando limites e integrações adequadas;
- condomínios, respeitando o escopo aplicável;
- escritórios;
- comércio;
- centros logísticos;
- academias;
- clubes;
- igrejas;
- fábricas;
- depósitos;
- laboratórios;
- instituições e organizações de diversos portes.

O sistema deve ser desenhado para ser utilizado em todo o Brasil, sem assumir regras específicas de uma única cidade, estado ou segmento.

---

# 3. POSICIONAMENTO DO PRODUTO

O Zela Acesso **não deve ser apresentado nem arquitetado como apenas um sistema de abertura de portas**.

O conceito central é:

> **Controle de acesso contextual, auditável e explicável.**

O sistema deve responder de forma estruturada:

- QUEM está tentando acessar?
- QUAL credencial está sendo utilizada?
- ONDE está tentando acessar?
- QUANDO está tentando acessar?
- QUAL política se aplica?
- QUAL é o estado da porta/dispositivo?
- QUAL é o estado da conexão?
- Existe alguma condição adicional?
- O acesso pode ser liberado?
- Se for negado, por quê?
- Qual evidência sustenta a decisão?

O diferencial central será o conceito de **Access Evidence / Evidência de Acesso**.

Cada decisão relevante de acesso deverá conseguir explicar, de forma auditável, por que foi liberada ou negada.

Exemplo de evento:

```text
EVENTO DE ACESSO

Pessoa: João da Silva
Credencial: Face
Ponto: Porta Financeiro 02
Data/Hora: 05/10/2026 08:03:21
Decisão: LIBERADO
Política: Funcionários Financeiro
Horário permitido: 08:00–18:00
Zona: Financeiro
Dispositivo: FIN-02
Estado do dispositivo: Online
Anti-passback: OK
Resultado físico: Porta abriu
Confirmação física: Sensor confirmou passagem
Motivo: Pessoa autorizada + credencial válida + horário válido + zona autorizada
Sincronização: Confirmada
```

O produto não deverá simplesmente mostrar “Entrada autorizada”.

Deverá permitir rastrear o contexto da decisão.

---

# 4. LIMITES DE ESCOPO E POSICIONAMENTO JURÍDICO DO MVP

## 4.1 O Zela Acesso é software de controle de acesso

O MVP deve ser construído e documentado como:

> **Plataforma tecnológica de controle de acesso físico.**

Não criar, no MVP, funções que façam a Arx Tecnologia assumir automaticamente atividades que possam caracterizar prestação de serviço regulado de segurança privada, monitoramento profissional de sistemas eletrônicos de segurança ou resposta operacional de segurança para terceiros.

A Lei nº 14.967/2024 instituiu o Estatuto da Segurança Privada e inclui entre os serviços regulados, entre outros, o monitoramento de sistemas eletrônicos de segurança. A mesma lei trata da autorização e fiscalização pela Polícia Federal e possui regras específicas para serviços orgânicos e portaria/controle de acesso em determinadas hipóteses.

Portanto:

- o software pode registrar e apresentar eventos ao cliente;
- o software pode gerar alertas ao cliente;
- o software pode permitir ao cliente administrar suas próprias políticas;
- o software pode integrar equipamentos;
- o software não deve vender no MVP “vigilância patrimonial terceirizada”;
- o software não deve prometer resposta armada;
- o software não deve oferecer “central de vigilância 24h da Arx” como parte do MVP;
- o software não deve realizar intervenção física em ocorrências;
- não desenvolver funcionalidades que dependam de vigilantes da Arx ou operadores externos como premissa do produto;
- qualquer futura funcionalidade de monitoramento profissional deverá passar por análise jurídica e regulatória específica antes de desenvolvimento/comercialização.

### 4.2 Não transformar Zela Acesso em sistema de ponto

Não implementar regras de controle de jornada, REP-P, REP-A, AFD, espelho de ponto ou qualquer lógica de ponto como parte do Zela Acesso.

O futuro **Zela Ponto** será um produto separado.

Apenas preparar APIs e eventos para integração futura.

Regra conceitual:

> **Acesso físico não é automaticamente marcação de ponto.**

---

# 5. PESQUISA REGULATÓRIA OBRIGATÓRIA ANTES DO CÓDIGO

Antes de implementar módulos relacionados a biometria, segurança, controle físico, visitantes, menores, emergência ou integração de hardware, consulte fontes oficiais e registre em documentação o que foi considerado.

### Fontes prioritárias

1. Planalto / legislação federal;
2. ANPD;
3. Ministério do Trabalho e Emprego, quando houver relação com ponto ou integração futura;
4. Polícia Federal, quando houver relação com segurança privada/monitoramento;
5. ABNT, quando houver norma técnica aplicável;
6. IEC, quando aplicável;
7. Corpo de Bombeiros competente e legislação estadual, quando houver requisitos físicos de emergência/incêndio;
8. documentação oficial dos fabricantes de hardware.

### Referências iniciais que DEVEM ser analisadas

- Lei nº 13.709/2018 — LGPD;
- Resolução CD/ANPD nº 15/2024 — Regulamento de Comunicação de Incidente de Segurança;
- Resolução CD/ANPD nº 18/2024 — atuação do encarregado;
- Resolução CD/ANPD nº 19/2024 — transferência internacional de dados, quando aplicável;
- documentos e notas técnicas atuais da ANPD sobre biometria e reconhecimento facial;
- Lei nº 15.211/2025 — ECA Digital, quando o sistema for utilizado com crianças/adolescentes ou em contextos aplicáveis;
- Decreto nº 12.622/2025;
- Decreto nº 12.880/2026;
- Lei nº 14.967/2024 — Estatuto da Segurança Privada;
- NR-23 — Proteção Contra Incêndios;
- ABNT NBR 9050 — acessibilidade, na edição vigente aplicável;
- IEC 60839-11-1 — Electronic Access Control Systems — System and Components Requirements;
- IEC 60839-11-2 — Electronic Access Control Systems — Application Guidelines;
- normas estaduais e instruções técnicas do Corpo de Bombeiros pertinentes à instalação física;
- demais normas técnicas que forem identificadas como aplicáveis ao hardware ou ambiente do cliente.

**Nunca declare “conforme a norma” apenas porque uma funcionalidade parece compatível.**

Diferencie sempre:

- requisito legal obrigatório;
- requisito regulatório;
- requisito normativo técnico;
- boa prática de engenharia;
- recomendação de produto;
- hipótese que precisa de validação jurídica/engenharia.

Se uma norma técnica for protegida por direitos autorais ou depender de acesso licenciado, **não invente seu conteúdo**. Registre a necessidade de acesso oficial e implemente somente o que estiver confirmado por fontes legítimas disponíveis.

---

# 6. SITUAÇÃO REGULATÓRIA RELEVANTE EM OUTUBRO/2026

## 6.1 LGPD e biometria

Dados biométricos vinculados a uma pessoa natural são dados pessoais sensíveis.

O sistema deve tratar biometria como categoria de alto cuidado.

Requisitos arquiteturais mínimos:

- finalidade definida;
- minimização;
- segregação por tenant;
- acesso estritamente necessário;
- criptografia em trânsito;
- criptografia em repouso quando aplicável;
- armazenamento privado;
- retenção configurável;
- exclusão/anonimização;
- auditoria;
- gestão de base legal;
- suporte a exercício de direitos;
- documentação das operações;
- proteção contra enumeração;
- proteção contra exfiltração;
- prevenção de replay/spoofing quando houver biometria;
- não armazenar imagem bruta sem necessidade definida e documentada.

## 6.2 Incidentes

O sistema deverá possuir mecanismos internos para:

- detectar eventos de segurança;
- registrar incidentes;
- preservar evidências;
- classificar severidade;
- identificar dados potencialmente afetados;
- registrar responsáveis;
- controlar prazo de resposta;
- apoiar a documentação necessária para eventual comunicação pelo controlador.

Não presumir que a Arx será sempre controladora. O cliente poderá ser controlador e a Arx poderá atuar como operadora em diversos cenários. A arquitetura e contratos deverão permitir essa diferenciação.

## 6.3 Crianças e adolescentes

Se o produto for utilizado em escolas ou outros cenários com menores:

- não tratar menores como simples extensão do cadastro adulto;
- criar estrutura para indicar categoria etária;
- separar políticas de tratamento aplicáveis;
- registrar responsável legal quando necessário;
- não presumir consentimento como base legal universal;
- permitir configuração específica de biometria e retenção;
- analisar ECA Digital e orientações da ANPD vigentes no momento da implementação;
- não implementar reconhecimento facial de menores como “padrão” sem avaliação específica de finalidade, necessidade, impacto e base legal.

## 6.4 Emergência e saída segura

O software não pode criar uma configuração que impeça, em situação de emergência, a saída segura exigida pelas características da edificação e pelas normas aplicáveis.

A lógica de fail-safe/fail-secure deverá ser uma propriedade configurável por ponto de acesso e instalação, não uma regra global simplista.

O sistema deverá permitir registrar:

- comportamento em perda de energia;
- comportamento em perda de comunicação;
- comportamento em emergência;
- dependência de fonte auxiliar;
- interface com alarmes, quando aplicável;
- rota de saída;
- responsável pela configuração.

O software não substitui projeto de incêndio, projeto elétrico, projeto de segurança, instalação certificada ou aprovação do Corpo de Bombeiros.

---

# 7. ARQUITETURA TECNOLÓGICA BASE

O Zela Acesso deve usar **a mesma stack base do Zela Escola**, evitando introduzir tecnologias diferentes sem necessidade. A prioridade é reutilização de conhecimento, padrões de segurança, componentes, convenções, testes e operação já dominados no ecossistema Zela/Arx.

## 7.1 Stack obrigatória de referência

Usar, salvo impedimento técnico comprovado e documentado:

- **React 19**;
- **Vite 8**;
- **JavaScript/JSX — NÃO usar TypeScript neste projeto**;
- **Tailwind CSS 4**;
- **Supabase**: PostgreSQL, Auth, Storage, Realtime e Edge Functions/Deno;
- **PostgreSQL RLS**;
- **Vitest** para testes unitários e de integração;
- **Playwright** para testes E2E;
- **ESLint/lint e validações JavaScript/JSX**;
- **Node.js** em versão compatível com a stack e com as ferramentas adotadas;
- **Docker Desktop** para o ambiente local;
- **Supabase CLI**;
- **Supabase Local** para desenvolvimento;
- **Edge Agent** do Zela Acesso quando iniciado, usando tecnologia compatível com o ecossistema JavaScript/Node ou outra opção explicitamente aprovada após análise técnica;
- CI compatível com a stack atual do Zela Escola.

## 7.2 Regras de compatibilidade com o Zela Escola

Antes de criar ou adotar qualquer tecnologia nova, verificar primeiro como o Zela Escola resolve o mesmo problema. Reutilizar padrões, bibliotecas e convenções existentes quando isso não comprometer os requisitos específicos do Zela Acesso.

Não introduzir por preferência pessoal:

- TypeScript;
- Next.js;
- outro framework frontend;
- outro ORM ou camada de persistência desnecessária;
- outra plataforma de backend;
- outro sistema de autenticação;
- outro framework de testes;
- outro framework CSS.

Qualquer exceção deve ser tecnicamente justificada e registrada em `docs/19-DECISIONS.md` antes da adoção.

> **Emenda R1 (contradição C-2 resolvida).** O texto original apontava `docs/ARCHITECTURE_DECISIONS.md`; o §8 e o projeto usam `docs/19-DECISIONS.md`. **O registro oficial de decisões é `docs/19-DECISIONS.md`.** Não criar `ARCHITECTURE_DECISIONS.md`.

## 7.3 JavaScript como padrão

Todo o código de aplicação será escrito em **JavaScript/JSX**, seguindo o padrão do Zela Escola.

Não criar:

- `.ts`;
- `.tsx`;
- `tsconfig.json`;
- tipos TypeScript;
- interfaces TypeScript;
- configuração de TypeScript apenas para “melhorar” o projeto.

Quando uma tipagem/documentação explícita for realmente útil, usar **JSDoc** e validação em runtime nos limites de entrada/saída.

## 7.4 Controle de versões e dependências

Antes de instalar uma dependência nova:

1. verificar se a stack atual do Zela Escola já possui solução equivalente;
2. verificar compatibilidade com React 19, Vite 8, Tailwind CSS 4, JavaScript e Supabase;
3. verificar manutenção e segurança do pacote;
4. evitar dependências redundantes;
5. registrar decisões relevantes em `docs/19-DECISIONS.md`.

Não fazer upgrade estrutural da stack por conta própria.

> **Emenda R1.** Validação de contratos (`packages/contracts`): o `docs/04-ARCHITECTURE.md` cita `zod`. Antes de adotá-lo, aplicar a regra do §7.2 (verificar como o Zela Escola valida entradas) e registrar a escolha em `docs/19-DECISIONS.md`. Enquanto não houver decisão, validar com funções puras testadas e JSDoc.

---

# 8. ESTRUTURA DE REPOSITÓRIO ESPERADA

Estrutura inicial recomendada:

```text
zela-acesso/
├── apps/
│   ├── web/
│   ├── edge-agent/
│   └── docs-site/                 # somente se realmente necessário
│
├── packages/
│   ├── domain/
│   ├── contracts/
│   ├── validation/
│   ├── security/
│   ├── ui/
│   ├── protocol/
│   ├── device-drivers/
│   └── config/
│
├── supabase/
│   ├── migrations/
│   ├── functions/
│   ├── seed/
│   └── tests/
│
├── docs/
│   ├── 00-PROJECT-CHARTER.md
│   ├── 01-SYSTEM-AUDIT.md
│   ├── 02-REQUIREMENTS.md
│   ├── 03-DOMAIN-MODEL.md
│   ├── 04-ARCHITECTURE.md
│   ├── 05-SECURITY.md
│   ├── 06-LGPD.md
│   ├── 07-REGULATORY-MATRIX.md
│   ├── 08-HARDWARE-INTEGRATION.md
│   ├── 09-OFFLINE-FIRST.md
│   ├── 10-ACCESS-EVIDENCE.md
│   ├── 11-API.md
│   ├── 12-E2E-SCENARIOS.md
│   ├── 13-DISASTER-RECOVERY.md
│   ├── 14-THREAT-MODEL.md
│   ├── 15-TEST-PLAN.md
│   ├── 16-DEPLOYMENT.md
│   ├── 17-OPERATIONS.md
│   ├── 18-COMPLIANCE-CHECKLIST.md
│   ├── 19-DECISIONS.md
│   └── 20-ROADMAP.md
│
├── scripts/
├── tests/
├── .github/
├── CLAUDE.md
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
└── package.json
```

Você pode ajustar esta estrutura se houver motivo técnico forte, mas qualquer mudança deve ser registrada.

> **Emenda R1 (gap A-3).** A árvore acima é o **alvo**; pacotes e apps são criados **sob demanda**, na fase que os exige, e não antecipadamente (§108, D-008):
>
> | Item | Quando |
> |---|---|
> | `packages/security` (hash de PIN, tokens, assinatura, cadeia de hash) | Fase 2B (credenciais) |
> | `packages/contracts` (contratos de eventos/comandos/API versionados) | Fase 3 |
> | `packages/device-drivers` (HAL + Mock) | contrato na Fase 3; Mock e primeiro adapter nas Fases 4 e 8 |
> | `apps/edge-agent` | Fase 4 |
> | `packages/validation`, `protocol`, `ui`, `config`, `apps/docs-site` | somente com necessidade comprovada e registro em `19-DECISIONS.md` |
>
> Estado atual: `apps/web`, `packages/domain`, `supabase/{migrations,functions,tests}`, `scripts/`, `e2e/` (testes Playwright na raiz, em vez de `tests/`). O seed vive em `scripts/seed-dev.mjs` (§0.2.8). O `docs/` também contém `ZELA_ACESSO_STATUS.md`, `ZELA_ACESSO_LOCAL_ENV.md` e (a criar) `ZELA_ACESSO_SKILLS.md`. O monorepo pnpm está **confirmado** por esta árvore: não há plano de "estrutura achatada".
>
> `docs/02-REQUIREMENTS.md` foi **incorporado a este documento** (Anexo C) e removido; os IDs RF-xx/RNF-xx continuam válidos.

---

# 9. SEPARAÇÃO DE DOMÍNIO

Não criar um banco genérico e acoplar tudo em uma tabela “events”.

O domínio precisa ser explícito.

Entidades principais:

```text
Organization
Tenant
Site
Building
Floor
Zone
AccessPoint
Controller
Reader
Lock
Sensor
Person
PersonType
Credential
BiometricProfile
AccessGroup
AccessPolicy
Schedule
HolidayCalendar
Visitor
Visit
Vehicle
AccessAttempt
AccessDecision
AccessEvent
AccessEvidence
Incident
AlertRule
AlertEvent
DeviceHeartbeat
DeviceCommand
EmergencyPlan
EmergencyActivation
AuditLog
DataSubjectRequest
ConsentRecord
RetentionPolicy
Integration
WebhookSubscription
ApiKey
ServiceAccount
```

Não criar todas automaticamente sem validar necessidade. O modelo deve ser normalizado e orientado ao domínio.

> **Emenda R1.** Terminologia: `Organization` (nome comercial/UI) = `tenant` (tabela e RLS). No banco e no código usar `tenant`; na interface, "organização". `Site` aparece na UI como "Local".

---

# 10. MODELO MULTI-TENANT

Este requisito é crítico.

Cada cliente deve ser isolado logicamente no banco.

Princípio:

```text
Platform
  └── Tenant
       └── Sites
            └── Buildings
                 └── Floors
                      └── Zones
                           └── Access Points
```

Todo dado de negócio deve possuir um caminho verificável até o tenant.

Requisitos:

- RLS em todas as tabelas de negócio expostas;
- nunca confiar no frontend para informar o tenant;
- tenant derivado da sessão/claims ou associação autorizada;
- evitar `service_role` no frontend;
- Edge Functions devem validar tenant;
- APIs devem validar organização e escopo;
- testes específicos devem tentar acessar dados de outro tenant;
- Realtime deve ser filtrado por tenant quando usado;
- Storage deve estar segregado por tenant;
- exports devem validar tenant;
- webhooks devem carregar tenant context;
- logs não podem vazar dados de outro tenant.

Criar testes automatizados de isolamento.

---

# 11. ROLES E RBAC

Papéis iniciais:

- `platform_owner` — Arx;
- `platform_support` — suporte Arx, acesso mínimo necessário;
- `organization_owner`;
- `organization_admin`;
- `security_manager`;
- `receptionist`;
- `hr_manager`;
- `auditor`;
- `installer`;
- `viewer`.

Não usar apenas uma coluna de role para autorizações complexas.

Criar possibilidade de:

- permissões por recurso;
- permissões por ação;
- escopo por unidade;
- escopo por zona;
- escopo por função;
- leitura sem alteração;
- operação sem administração.

Exemplo:

```text
security_manager
  pode:
    visualizar eventos
    configurar políticas
    bloquear credencial
  não pode:
    excluir logs
    acessar dados internos da Arx
    alterar billing
```

> **Emenda R1.** Implementação vigente: `platform_role` (platform_owner, platform_support) e `tenant_role` (os 8 demais) são enums separados; a matriz de permissões (`role_permissions`, recurso:ação) existe no banco e no código e é conferida por `pnpm rbac:drift`. Autorização por consulta ao banco (`has_permission`), sem papéis em claims do JWT (D-014).

---

# 12. MOTOR DE DECISÃO DE ACESSO

Este é o núcleo do produto.

Não espalhar regras de autorização por componentes React.

Criar um domínio centralizado e testável:

```text
evaluateAccess(context) -> AccessDecision
```

O `context` deverá poder conter:

```text
person
credential
accessPoint
zone
currentTime
timezone
schedule
holiday
tenantPolicy
personStatus
credentialStatus
deviceStatus
antiPassbackState
emergencyState
visitState
riskSignals
offlineState
```

A decisão deverá possuir:

```text
ALLOW
DENY
CHALLENGE
DEGRADED_ALLOW
DEGRADED_DENY
```

Evitar ambiguidades.

Cada decisão deve gerar um código de motivo.

Exemplos:

```text
CREDENTIAL_INVALID
CREDENTIAL_EXPIRED
PERSON_DISABLED
OUTSIDE_SCHEDULE
ZONE_NOT_ALLOWED
VISITOR_EXPIRED
VISITOR_ZONE_NOT_ALLOWED
ANTI_PASSBACK
EMERGENCY_POLICY
DEVICE_UNTRUSTED
OFFLINE_POLICY_DENY
OFFLINE_POLICY_ALLOW
POLICY_MATCH
MULTI_FACTOR_REQUIRED
```

Os códigos devem ser estáveis para relatórios e integrações.

---

# 13. ACESSO CONTEXTUAL / ACCESS INTELLIGENCE

Criar a base para um motor contextual, sem depender inicialmente de IA generativa.

Regra:

**Não use IA generativa para decidir diretamente se uma porta deve abrir.**

A decisão de controle físico deve ser determinística, testável e explicável.

IA poderá, posteriormente, auxiliar em:

- análise de padrões;
- resumo de incidentes;
- detecção de anomalias;
- sugestão de políticas;
- análise de logs;
- busca semântica;
- relatórios.

Mas a decisão final de liberar/negar no núcleo do MVP deverá ser baseada em regras determinísticas.

---

# 14. ACCESS EVIDENCE

Cada tentativa de acesso deverá possuir evidência estruturada.

Modelo conceitual:

```text
AccessAttempt
  ├── IdentityEvidence
  ├── CredentialEvidence
  ├── LocationEvidence
  ├── TimeEvidence
  ├── PolicyEvidence
  ├── DeviceEvidence
  ├── AntiPassbackEvidence
  ├── DecisionEvidence
  └── PhysicalOutcomeEvidence
```

Exemplo:

```json
{
  "decision": "ALLOW",
  "reasonCode": "POLICY_MATCH",
  "personId": "...",
  "credentialId": "...",
  "accessPointId": "...",
  "policyId": "...",
  "scheduleId": "...",
  "deviceState": "ONLINE",
  "antiPassback": "OK",
  "physicalOutcome": "DOOR_OPENED",
  "source": "EDGE_AGENT",
  "synchronizedAt": "..."
}
```

Esses dados deverão ser assinados/hashados quando tecnicamente adequado para detectar alteração indevida.

Não permitir edição direta de eventos históricos.

---

# 15. EVENTOS IMUTÁVEIS

Eventos de acesso não devem ser “editados”.

Correções administrativas devem gerar novos eventos de correção/reconciliação, preservando:

- evento original;
- usuário;
- momento;
- motivo;
- valor corrigido;
- justificativa;
- cadeia de auditoria.

Implementar o conceito de append-only para o histórico crítico sempre que possível.

---

# 16. CREDENCIAIS

MVP deve suportar arquitetura para:

- cartão RFID/NFC, conforme hardware integrado;
- PIN;
- QR Code;
- biometria facial;
- credencial móvel/token, quando implementada;
- múltiplas credenciais para a mesma pessoa.

Uma pessoa pode possuir:

```text
Face: ativa
Cartão: ativo
PIN: ativo
QR temporário: expirado
```

Cada credencial deve possuir:

- tipo;
- identificador/token seguro;
- status;
- data de criação;
- validade;
- última utilização;
- revogação;
- motivo de revogação;
- escopo;
- tenant;
- auditoria.

Nunca armazenar PIN em texto puro.

Nunca exibir segredo de credencial após cadastro.

Tokens de QR temporários devem ser de alta entropia, com expiração e revogação.

---

# 17. BIOMETRIA FACIAL

Implementar por arquitetura modular.

Não acoplar o produto a um único motor.

Conceito:

```text
BiometricProvider
  ├── LocalProvider
  ├── ProviderA
  └── ProviderB
```

O motor escolhido deve ficar atrás de uma interface.

Requisitos:

- cadastro guiado;
- qualidade mínima;
- prevenção de duplicidade quando tecnicamente possível;
- liveness/anti-spoofing quando disponibilizado pelo motor;
- threshold configurável de forma segura;
- fallback para outro método de identificação;
- registro de versão do motor;
- registro de dispositivo;
- não armazenar imagens desnecessárias;
- política de retenção;
- exclusão;
- auditoria;
- avaliação de falsos positivos/falsos negativos;
- testes com condições de iluminação e dispositivos reais.

Não afirmar “prova de vida” se o componente usado não oferecer liveness real.

---

# 18. OFFLINE-FIRST / EDGE

Este requisito é obrigatório.

A internet do cliente pode cair.

O controle de acesso previamente configurado não pode simplesmente parar porque a nuvem ficou indisponível, salvo quando a política de segurança definida pelo cliente determinar o contrário.

Criar um **Edge Agent**.

Responsabilidades:

- conectar-se às controladoras;
- armazenar políticas locais;
- armazenar credenciais necessárias;
- aplicar regras locais;
- validar relógio;
- armazenar eventos em fila;
- sincronizar com a nuvem;
- detectar conflito;
- monitorar dispositivos;
- receber comandos autorizados;
- enviar heartbeats;
- reportar versão;
- aplicar atualizações de forma segura.

Arquitetura:

```text
CLOUD
  │
  │ TLS
  ▼
EDGE AGENT
  │
  ├── Local DB
  ├── Policy Cache
  ├── Credential Cache
  ├── Event Queue
  ├── Device Drivers
  └── Health Monitor
       │
       ▼
CONTROLADOR / DISPOSITIVO
```

---

# 19. EDGE AGENT: REQUISITOS DE SEGURANÇA

O Edge Agent é componente crítico.

Implementar:

- autenticação mútua ou estratégia equivalente forte entre agent e cloud;
- identificação única do dispositivo;
- device enrollment;
- rotação de credenciais;
- revogação;
- armazenamento protegido de secrets;
- assinatura de comandos quando aplicável;
- proteção contra replay;
- idempotência;
- fila persistente;
- retries com backoff;
- circuit breaker;
- watchdog/health check;
- logs locais com rotação;
- atualização segura;
- versão mínima suportada;
- bloqueio de agente comprometido/revogado.

Não permitir que um simples request HTTP local abra uma porta sem autenticação.

---

# 20. INTEGRAÇÃO DE HARDWARE

Criar arquitetura de adaptadores/drivers.

Não misturar protocolo de fabricante com regras de negócio.

Estrutura conceitual:

```text
Domain
   ↓
Hardware Abstraction Layer
   ↓
Driver / Adapter
   ↓
Protocol / SDK
   ↓
Hardware
```

Tipos de hardware esperados:

- controladoras;
- leitores;
- fechaduras;
- relés;
- sensores de porta;
- botoeiras;
- catracas;
- torniquetes;
- cancelas;
- dispositivos de saída;
- dispositivos de emergência.

Preparar arquitetura para:

- TCP/IP;
- HTTPS;
- REST;
- WebSocket;
- MQTT, quando aplicável;
- Wiegand;
- OSDP;
- SDK de fabricante.

Não implementar protocolo fictício.

Quando a documentação do fabricante não estiver disponível, criar interface mock e adapter pendente.

---

# 21. DISPOSITIVOS E INVENTÁRIO

Cada dispositivo deve possuir:

- nome;
- tipo;
- fabricante;
- modelo;
- número de série;
- MAC/IP quando aplicável;
- firmware;
- unidade;
- zona;
- ponto de acesso;
- última comunicação;
- status;
- versão do adapter;
- data de instalação;
- garantia;
- observações;
- documentação técnica;
- histórico de manutenção.

Estados:

```text
ONLINE
OFFLINE
DEGRADED
MAINTENANCE
REVOKED
UNKNOWN
```

---

# 22. PONTOS DE ACESSO

Um ponto de acesso pode ser:

- porta;
- portão;
- catraca;
- torniquete;
- cancela;
- elevador ou outro equipamento compatível;
- área virtual associada a controle físico.

Dados mínimos:

- nome;
- tipo;
- zona;
- direção;
- controlador;
- leitor de entrada;
- leitor de saída;
- sensor;
- relé;
- política;
- horário;
- comportamento de emergência;
- comportamento offline;
- timeout de porta aberta.

---

# 23. ZONAS E HIERARQUIA FÍSICA

Hierarquia:

```text
Organization
  → Site
    → Building
      → Floor
        → Zone
          → Access Point
```

A política poderá ser aplicada em:

- pessoa;
- grupo;
- zona;
- ponto;
- horário;
- período.

Evitar configuração manual de centenas de combinações quando uma regra de grupo/zoneamento resolver.

> **Emenda R1 (gap A-1).** Estado: existem `sites` e `zones` (zona direto sob o local); **não existem** `buildings` nem `floors`. Regra para fechar a lacuna sem quebrar o que existe:
>
> 1. `Building` e `Floor` entram como **níveis opcionais**: criar as tabelas (`tenant_id` + FK composta, como em `zones`) e adicionar `building_id`/`floor_id` **anuláveis** em `zones`. Uma zona continua válida sem prédio/andar.
> 2. Fazer isso na **Fase 2C**, *antes* de criar `access_points`, para que o ponto de acesso herde o caminho completo até o tenant.
> 3. Tornar os níveis obrigatórios é uma decisão do dono (registrar em `19-DECISIONS.md`); a recomendação é manter opcional para clientes de 1 porta/1 local (§40).
> 4. Toda a hierarquia tem RLS, FK composta com `tenant_id`, privilégios por coluna (D-012) e testes cross-tenant em pgTAP.

---

# 24. POLÍTICAS DE ACESSO

Criar um motor para políticas compostas.

Exemplo:

```text
Funcionários Financeiro

SEG–SEX
07:30–18:30

Zonas:
- Portaria
- Administrativo
- Financeiro

Bloqueado:
- TI
- Produção

Feriados:
NEGADO
```

Permitir regras como:

- horários;
- dias da semana;
- feriados;
- datas de início/fim;
- zonas;
- pontos;
- tipo de pessoa;
- visitante;
- credencial;
- multi-factor;
- anti-passback;
- emergência;
- estado do dispositivo.

Não criar uma linguagem de regras excessivamente complexa no MVP.

Começar com estrutura declarativa e validável.

> **Emenda R1.** Nome na interface: "Janelas de acesso" (antes "Horários"), para evitar confusão com controle de ponto (decisão do dono, commit fca5551). No domínio permanecem `Schedule`/`HolidayCalendar`.

---

# 25. ANTI-PASSBACK

Implementar:

- Soft Anti-Passback;
- Hard Anti-Passback;
- zonas de entrada/saída;
- estado PRESENTE/AUSENTE/UNKNOWN;
- exceções administrativas auditáveis.

Nunca confiar somente no frontend para manter esse estado.

O estado crítico deve ser mantido no backend/edge de forma consistente.

---

# 26. VISITANTES

MVP deve incluir visitantes.

Fluxo:

```text
Anfitrião
  ↓
Pré-cadastro
  ↓
Convite
  ↓
QR/token temporário
  ↓
Chegada
  ↓
Validação
  ↓
Check-in
  ↓
Acesso limitado
  ↓
Check-out
  ↓
Credencial expirada
```

Dados:

- nome;
- documento, quando necessário e permitido;
- empresa;
- anfitrião;
- motivo;
- data;
- horário;
- zonas permitidas;
- veículo;
- placa;
- acompanhante;
- validade;
- termos/avisos de privacidade;
- status.

Não coletar documento apenas porque “seria interessante”. Aplicar minimização.

---

# 27. VEÍCULOS

Estruturar cadastro de veículos no MVP, mas deixar LPR/OCR avançado para fase posterior.

Dados:

- placa;
- marca;
- modelo;
- cor;
- proprietário;
- empresa;
- validade;
- vaga ou área;
- credencial associada.

A plataforma deverá estar preparada para futuramente receber eventos de leitura de placa.

---

# 28. PRESENÇA / QUEM ESTÁ DENTRO

Implementar dashboard de ocupação operacional.

Exemplo:

```text
PESSOAS PRESENTES

Total: 247
Funcionários: 212
Visitantes: 18
Terceiros: 17

Portaria: 54
Prédio A: 133
Prédio B: 60
```

Isso deverá ser derivado dos eventos e políticas, com tratamento explícito de inconsistências.

Não presumir que “último evento” é sempre suficiente. Registrar estado de confiança.

Exemplo:

```text
PRESENT
ABSENT
UNKNOWN
CONFLICTED
```

---

# 29. PORTA ABERTA / PORTA FORÇADA

Suportar:

- door held open;
- door forced open;
- sensor inconsistente;
- controlador offline;
- leitor offline;
- comando manual;
- abertura autorizada;
- abertura não identificada.

Exemplos de alertas:

```text
PORTA_MANTIDA_ABERTA
PORTA_FORCADA
SENSOR_INCONSISTENTE
COMANDO_MANUAL
DEVICE_OFFLINE
```

---

# 30. EMERGÊNCIA

Criar módulo de planos de emergência, mas sem pretender substituir os planos físicos e legais da edificação.

Estrutura:

```text
EmergencyPlan
EmergencyType
EmergencyActivation
EmergencyAction
EmergencyAudit
```

Tipos configuráveis:

- incêndio;
- evacuação;
- emergência geral;
- outro definido pelo cliente.

O comportamento das portas deverá ser configurável por instalação, respeitando saída segura.

Toda ativação exige:

- usuário;
- autenticação;
- motivo;
- timestamp;
- escopo;
- ações executadas;
- resultado de cada ação;
- encerramento.

Se o acionamento vier de integração externa, registrar a origem.

---

# 31. CENTRAL DE EVENTOS

Dashboard principal:

```text
Pessoas dentro
Portas online
Dispositivos offline
Acessos liberados
Acessos negados
Visitantes presentes
Incidentes abertos
Portas abertas
Eventos recentes
```

Filtros:

- unidade;
- prédio;
- zona;
- porta;
- pessoa;
- tipo;
- período;
- resultado;
- severidade.

Atualização em tempo real quando online.

---

# 32. ALERTAS

Criar motor de alertas baseado em regras.

Exemplos:

- 5 tentativas negadas em 2 minutos;
- porta aberta por mais de X segundos;
- dispositivo offline por mais de X minutos;
- credencial revogada tentando acessar;
- visitante fora da janela;
- acesso fora do horário;
- tentativa em zona restrita;
- sensor inconsistente;
- falha de sincronização.

Canais futuros:

- dashboard;
- e-mail;
- push;
- webhook;
- integração externa.

Não criar SMS/WhatsApp obrigatoriamente no MVP.

---

# 33. AUDITORIA ADMINISTRATIVA

Registrar ações sensíveis:

- criação;
- alteração;
- revogação;
- exclusão lógica;
- mudança de permissão;
- mudança de política;
- mudança de hardware;
- desbloqueio manual;
- ativação de emergência;
- visualização de dados sensíveis quando auditável;
- exportação;
- alteração de retenção;
- acesso a dados biométricos;
- alteração de configuração offline.

Campos:

```text
actor
actorType
tenant
resourceType
resourceId
action
before
after
reason
ip
userAgent
timestamp
correlationId
```

Cuidado para não registrar segredos ou dados sensíveis desnecessariamente nos próprios logs.

> **Emenda R1 (gap A-2).** Estado: `audit_log` tem `id`, `tenant_id`, `actor_user_id`, `action`, `resource_type`, `resource_id`, `metadata jsonb`, `created_at` e é append-only (UPDATE/DELETE/TRUNCATE bloqueados por privilégio e trigger). **Faltam** `actor_type`, `before`, `after`, `reason`, `ip`, `user_agent` e `correlation_id` como colunas.
>
> Regras para fechar a lacuna:
>
> 1. Migration **aditiva** (colunas anuláveis; sem reescrever o histórico), concluída **antes do gate da Fase 3** — o Access Evidence depende de `correlation_id` (§39, §106).
> 2. Preservar o append-only e os testes existentes; acrescentar pgTAP que prove que as novas colunas também não são editáveis.
> 3. `ip` e `user_agent` são conhecidos apenas na borda: preenchê-los por Edge Function/serviço, **não** por trigger de banco. Eventos gerados por trigger deixam esses campos nulos.
> 4. `before`/`after` seguem a regra de logs: nunca PIN, token, segredo, biometria ou dados pessoais desnecessários (hoje a auditoria da 2A já evita nome/`external_ref`).
> 5. Hash encadeado dos eventos de acesso: Fase 3 (§14, §94); o `audit_log` administrativo pode adotá-lo na mesma fase.

---

# 34. SEGURANÇA DE APLICAÇÃO

Aplicar pelo menos:

- OWASP ASVS como referência de engenharia;
- OWASP Top 10;
- secure defaults;
- princípio do menor privilégio;
- defesa em profundidade;
- validação server-side;
- autorização server-side;
- rate limiting;
- proteção contra brute force;
- proteção contra replay;
- proteção contra CSRF onde aplicável;
- proteção XSS;
- SQL injection via queries parametrizadas/ORM/SDK;
- SSRF quando houver fetch de URLs;
- upload seguro;
- malware scanning quando aplicável;
- secrets fora do código;
- rotação de secrets;
- logs sem credenciais;
- dependências auditadas;
- SAST/lint e validações estáticas compatíveis com JavaScript/JSX;
- testes de segurança automatizados quando possível.

> **Emenda R1 (gap A-10).** Rate limiting existe no Auth e no chat de suporte; **não** existe nas Edge Functions. Antes de publicar qualquer função: limite por (ator, tenant, rota) com janela configurável, implementado no Postgres (sem Redis, D-008), resposta 429 sem vazar informação, e teste automatizado. Funções que chamam terceiros (ex.: `lookup-cnpj`) devem limitar também a saída (SSRF: destino fixo, sem URL vinda do cliente).

---

# 35. AUTENTICAÇÃO

Usar Supabase Auth ou equivalente aprovado pela arquitetura.

Requisitos:

- sessão segura;
- expiração/refresh correto;
- proteção contra sessão roubada;
- suporte a 2FA/MFA para administradores;
- recuperação de senha segura;
- convite de usuários;
- revogação de sessão;
- auditoria;
- políticas específicas para contas privilegiadas.

MFA deve ser tratado como requisito para usuários administrativos em ambiente de produção, não apenas como funcionalidade cosmética.

> **Emenda R1 (gap A-5).** Estado: TOTP habilitado no Auth, **não exigido** (D-016). Para cumprir este requisito:
>
> 1. **Prazo:** MFA exigido para os papéis administrativos (`platform_owner`, `organization_owner`, `organization_admin` e os demais que a decisão D-016 listar) **antes de qualquer dado real ou piloto** (§110) — não esperar a Fase 9.
> 2. **Aplicação no servidor:** ações sensíveis passam a exigir `aal2` (verificado a partir do JWT, por exemplo `auth.jwt() ->> 'aal'`) dentro de `has_permission`/policies, sem depender do frontend. Isso é compatível com D-014 (o `aal` não é claim de papel/tenant), mas deve ser validado em teste.
> 3. **Frontend:** fluxo de cadastro do fator, desafio no login e recuperação (perda do dispositivo) sem criar bypass administrativo escondido (§60).
> 4. **Ambientes:** em local/E2E o requisito é configurável por flag explícita, nunca desligado por padrão no remoto; registrar a decisão em `19-DECISIONS.md`.
> 5. Testes: pgTAP (sem `aal2` → negado para ação sensível) e E2E do fluxo.

---

# 36. STORAGE

Não usar storage público para:

- fotos de pessoas;
- biometria;
- documentos;
- comprovantes;
- arquivos privados.

Criar buckets privados e autorização por tenant.

URLs assinadas deverão ter expiração curta quando forem realmente necessárias.

> **Emenda R1 (gap A-8).** Ainda não há buckets nas migrations. Ao implementar o primeiro upload (visitantes na Fase 5, biometria na Fase 7, ou antes se outra feature exigir): bucket **privado** por finalidade; caminho com prefixo `{tenant_id}/…`; policies em `storage.objects` que derivam o tenant do caminho e checam `has_permission`; URLs assinadas curtas; pgTAP cross-tenant para upload/leitura/exclusão. Logos e imagens de login da plataforma (`system_settings`) seguem a regra já aplicada (só PNG/JPG/WebP ou https).

---

# 37. API E INTEGRAÇÕES

Criar API desde o início.

Endpoints conceituais:

```text
POST   /organizations
POST   /sites
POST   /people
POST   /credentials
POST   /zones
POST   /access-points
POST   /access-policies
POST   /visitors
POST   /vehicles
POST   /devices/enroll
POST   /access/evaluate
GET    /access/events
GET    /occupancy
GET    /incidents
GET    /devices
POST   /devices/{id}/commands
POST   /webhooks
```

A implementação final poderá usar outra convenção REST/GraphQL, desde que documentada.

---

# 38. WEBHOOKS

Criar eventos estáveis:

```text
access.granted
access.denied
access.challenge
access.physical_confirmed
door.opened
door.forced
door.held_open
device.online
device.offline
credential.revoked
visitor.checked_in
visitor.checked_out
emergency.started
emergency.ended
incident.created
incident.resolved
```

Webhooks devem ter:

- assinatura;
- idempotency key;
- retry;
- dead letter strategy;
- logs;
- proteção contra replay.

---

# 39. OBSERVABILIDADE

Produzir:

### Logs
Estruturados e correlacionáveis.

### Métricas

- latência de decisão;
- acessos por minuto;
- taxa de negação;
- falhas de hardware;
- agentes offline;
- fila offline;
- tempo de sincronização;
- erros por tenant;
- erros por driver.

### Traces
Usar OpenTelemetry quando fizer sentido.

Toda transação crítica deverá possuir `correlationId`.

---

# 40. ESCALABILIDADE

Projetar para crescer de:

```text
1 empresa / 1 porta
```

até:

```text
milhares de organizações
milhares de unidades
centenas de milhares ou milhões de pessoas
milhares de pontos de acesso
milhões de eventos
```

Não presumir que o dashboard consultará toda a tabela de eventos em cada carregamento.

Criar:

- índices apropriados;
- paginação;
- filtros server-side;
- agregações;
- views/materialized views quando justificadas;
- particionamento quando volume exigir;
- retenção configurável;
- arquivamento;
- filas/eventos;
- processamento assíncrono quando necessário.

Não usar `SELECT *` em endpoints críticos sem necessidade.

---

# 41. BANCO DE DADOS

Antes de criar migrations:

1. desenhe ERD;
2. identifique chaves;
3. identifique índices;
4. identifique constraints;
5. identifique foreign keys;
6. identifique unique constraints;
7. identifique regras de tenant;
8. identifique retenção;
9. identifique dados sensíveis;
10. identifique campos imutáveis.

Preferir constraints no banco em vez de confiar apenas no backend.

---

# 42. CONSISTÊNCIA E IDEMPOTÊNCIA

Eventos de hardware podem chegar duplicados.

O sistema deve aceitar reenvio sem duplicar efeitos críticos.

Usar:

- eventId;
- deviceEventId;
- idempotencyKey;
- sequence;
- timestamps do dispositivo e do servidor;
- política de reconciliação.

Nunca assumir entrega “exactly once” na rede.

Projetar para:

> at-least-once delivery + idempotência.

---

# 43. CLOCK / DATA E HORA

Controle de acesso depende de tempo.

Implementar cuidado específico com:

- timezone da organização;
- timezone do site;
- horário de verão quando aplicável;
- relógio do dispositivo;
- drift;
- eventos fora de ordem;
- sincronização NTP quando disponível;
- timestamp do evento;
- timestamp de recebimento;
- timestamp de processamento.

Não usar apenas `new Date()` no frontend para uma decisão física crítica.

> **Emenda R1 (gap A-9).** Estado: apenas `sites.timezone` (padrão `America/Sao_Paulo`). Acrescentar `tenants.timezone` (padrão da organização) na migration da **Fase 2B** (janelas de acesso/feriados): o site usa o próprio fuso quando definido e herda o do tenant quando não. A avaliação de janelas usa sempre o fuso do **site** do ponto de acesso, no servidor/edge.

---

# 44. RETENÇÃO DE DADOS

Configurar políticas de retenção por categoria.

Exemplo conceitual:

```text
Eventos de acesso
Biometria
Logs administrativos
Logs técnicos
Visitantes
Incidentes
Documentos
```

Os valores padrão devem ser definidos após análise jurídica/regulatória e permitir configuração pelo cliente dentro dos limites técnicos/contratuais.

Nunca implementar “guardar para sempre” como padrão sem justificativa.

> **Emenda R1 (gap A-7, vale para §44–46).** As tabelas `retention_policy`, `data_subject_request` e `consent_record` (com campo de base legal por finalidade) **ainda não existem**; o `docs/03-DOMAIN-MODEL.md` as lista como "posteriores". Regra: criá-las **antes de qualquer dado real/piloto** (no máximo na Fase 9, antes da Fase 10), cada uma com `tenant_id`, RLS, auditoria e pgTAP; criar `docs/06-LGPD.md` junto. Valores padrão de retenção só após parecer jurídico (§5, §6).

---

# 45. DIREITOS DOS TITULARES

Criar arquitetura para suportar:

- acesso aos dados;
- correção;
- informação;
- eliminação/anonimização quando cabível;
- portabilidade quando aplicável;
- revisão de tratamento conforme hipótese;
- oposição quando aplicável;
- gestão de solicitações.

Criar entidade:

`DataSubjectRequest`

com workflow e auditoria.

---

# 46. CONSENTIMENTO

Não tratar “consentimento” como solução universal.

Quando o produto usar consentimento:

- registrar versão do aviso;
- data/hora;
- finalidade;
- contexto;
- responsável quando aplicável;
- origem;
- revogação;
- versão da política.

Quando outro fundamento legal for usado pelo controlador, permitir registrar a base legal sem fingir que existe consentimento.

---

# 47. ACESSIBILIDADE

Aplicar acessibilidade na interface web.

Requisitos mínimos:

- navegação por teclado;
- foco visível;
- contraste adequado;
- labels;
- mensagens de erro compreensíveis;
- uso correto de ARIA quando necessário;
- não depender somente de cor;
- tamanho de toque adequado;
- leitores de tela.

Para hardware/instalação, o software deve permitir registrar se existe rota/ponto acessível e emitir alerta documental quando a instalação estiver incompleta.

---

# 48. UI / UX

O produto deve parecer corporativo, moderno e operacional.

Não construir um painel cheio de cards inúteis.

Prioridade:

1. situação atual;
2. eventos críticos;
3. operação;
4. busca;
5. configuração;
6. auditoria.

A interface deverá funcionar bem em:

- desktop;
- notebook;
- tablet.

Não tratar o painel operacional como uma página administrativa genérica.

---

# 49. MENU PRINCIPAL DO MVP

Estrutura recomendada:

```text
📊 Visão Geral

🏢 Organização
   ├── Unidades
   ├── Edificações
   ├── Zonas
   └── Planta / Estrutura

👥 Pessoas
   ├── Pessoas
   ├── Grupos
   ├── Credenciais
   └── Bloqueios

🚪 Controle de Acesso
   ├── Pontos de Acesso
   ├── Políticas
   ├── Horários
   ├── Feriados
   └── Anti-passback

👤 Visitantes
   ├── Convites
   ├── Check-in
   ├── Presentes
   └── Histórico

🚗 Veículos

🖥️ Dispositivos
   ├── Controladoras
   ├── Leitores
   ├── Sensores
   ├── Edge Agents
   └── Saúde dos dispositivos

🚨 Eventos e Incidentes
   ├── Eventos
   ├── Alertas
   ├── Incidentes
   └── Emergências

👁️ Pessoas Presentes

📜 Auditoria

🔐 Privacidade e LGPD

⚙️ Configurações

🔗 Integrações
```

Podem existir menus adicionais quando justificadamente necessários.

> **Emenda R1.** Diferenças aceitas: "Horários" → "Janelas de acesso"; "Unidades" na UI corresponde a `sites` ("Locais"). O menu da plataforma (Painel do Desenvolvedor — Gestão de Organizações, Planos, Faturamento, Logs, Biometria, Suporte, Configurações) é um escopo separado do menu do cliente acima (Anexo A).

---

# 50. DASHBOARD EXECUTIVO

Mostrar:

```text
Unidades
Pontos online
Pontos offline
Pessoas presentes
Visitantes presentes
Acessos hoje
Negados hoje
Incidentes abertos
Portas em alerta
Última sincronização
```

Não misturar métricas de RH/ponto com métricas de acesso.

---

# 51. DASHBOARD OPERACIONAL

Tela própria para recepção/segurança:

```text
ÚLTIMOS EVENTOS

08:03  João      Portaria      LIBERADO
08:04  Maria     Financeiro    LIBERADO
08:05  Visitante  Recepção      AGUARDANDO
08:06  Carlos    TI            NEGADO
08:07  Porta 02               ALERTA
```

Permitir drill-down para Access Evidence.

---

# 52. RELATÓRIOS

MVP:

- eventos de acesso;
- negados;
- acessos por pessoa;
- acessos por porta;
- visitantes;
- pessoas presentes;
- incidentes;
- dispositivos;
- auditoria;
- indisponibilidade de dispositivos.

Exportações:

- CSV;
- PDF somente quando houver valor real;
- API.

Exportação deverá respeitar tenant e permissões.

---

# 53. DIFERENCIAL DE PRODUTO — ACCESS EVIDENCE

Todo acesso relevante deverá poder gerar uma página de evidência com:

### Identidade
Quem?

### Credencial
Como?

### Local
Onde?

### Horário
Quando?

### Política
Qual regra?

### Contexto
Quais condições?

### Decisão
Liberou/negou?

### Físico
A porta realmente abriu?

### Integridade
O evento foi sincronizado corretamente?

### Auditoria
Quem alterou alguma configuração relacionada?

Essa funcionalidade é estratégica e deve estar presente desde o MVP.

---

# 54. INTELIGÊNCIA FUTURA

Criar interfaces para futuramente adicionar:

- detecção de anomalias;
- comportamento fora do padrão;
- risco contextual;
- recomendações;
- resumos de incidentes;
- busca em linguagem natural;
- relatórios executivos;
- correlação entre eventos.

Mas **não incluir IA generativa como dependência da decisão física no MVP**.

---

# 55. TESTES OBRIGATÓRIOS

O projeto não estará pronto apenas porque compila.

Criar testes para:

### Unitários

- motor de decisão;
- políticas;
- schedules;
- timezone;
- anti-passback;
- visitantes;
- credenciais;
- retenção;
- segurança.

### Banco/RLS

- tenant isolation;
- role permissions;
- cross-tenant attack attempts;
- storage permissions.

### Integração

- Edge ↔ cloud;
- retry;
- duplicação;
- offline/online;
- webhook;
- device heartbeat.

### E2E

Fluxos completos:

1. criar organização;
2. criar unidade;
3. criar zona;
4. criar pessoa;
5. criar credencial;
6. criar ponto;
7. criar política;
8. permitir acesso;
9. negar acesso;
10. gerar evidência;
11. registrar visitante;
12. check-in;
13. check-out;
14. colocar dispositivo offline;
15. executar acesso offline;
16. reconectar;
17. sincronizar;
18. verificar histórico;
19. ativar emergência;
20. verificar auditoria.

---

# 56. TESTES DE SEGURANÇA MULTI-TENANT

Este conjunto é obrigatório.

Criar pelo menos:

```text
Tenant A não consegue ler dados do Tenant B.
Tenant A não consegue inserir dados no Tenant B.
Tenant A não consegue alterar dados do Tenant B.
Tenant A não consegue excluir dados do Tenant B.
Usuário sem permissão não consegue abrir porta.
Usuário sem permissão não consegue enviar comando de hardware.
Usuário de auditoria não consegue alterar política.
Installer não consegue acessar dados globais.
Platform support não deve acessar dados privados sem mecanismo autorizado/auditado.
```

Testar RLS diretamente.

---

# 57. TESTES DO EDGE AGENT

Testar:

- perda de internet;
- perda de energia do agente;
- restart;
- corrupção de fila;
- evento duplicado;
- evento fora de ordem;
- controlador offline;
- clock incorreto;
- cloud indisponível;
- cloud lenta;
- reconexão;
- atualização do agente;
- credencial revogada enquanto offline;
- política alterada enquanto offline;
- conflito de versão.

---

# 58. CRITÉRIOS DE ACEITE DO MVP

O MVP só poderá ser considerado pronto quando:

### Produto

- cadastro de organizações funcionando;
- múltiplas unidades funcionando;
- pessoas funcionando;
- grupos funcionando;
- credenciais funcionando;
- pontos de acesso funcionando;
- zonas funcionando;
- políticas funcionando;
- horários funcionando;
- visitantes funcionando;
- eventos funcionando;
- auditoria funcionando;
- alertas básicos funcionando;
- dashboard funcionando;
- Access Evidence funcionando;
- offline funcionando;
- sincronização funcionando.

### Segurança

- RLS implementado;
- RBAC implementado;
- MFA administrativo preparado/ativo;
- secrets seguros;
- logs sem vazamento;
- storage privado;
- rate limiting;
- validações server-side.

### Qualidade

- build passando;
- lint passando;
- lint/validações JavaScript passando;
- testes passando;
- E2E passando;
- migrations reproduzíveis;
- seed funcionando;
- documentação atualizada.

### Operação

- deploy reproduzível;
- observabilidade;
- backup;
- restore testado em ambiente de teste;
- health checks;
- logs;
- alertas técnicos.

---

# 59. DEFINIÇÃO DE “PRONTO”

Nunca marcar uma tarefa como concluída somente porque:

- a tela aparece;
- o botão funciona no frontend;
- o banco aceita o registro;
- o código compila.

Uma funcionalidade crítica somente está pronta quando:

```text
Requisito
  ↓
Implementação
  ↓
Validação
  ↓
Teste unitário
  ↓
Teste integração
  ↓
Teste de segurança
  ↓
Teste E2E quando aplicável
  ↓
Documentação
  ↓
Observabilidade
  ↓
Critério de aceite
  ↓
DONE
```

---

# 60. NÃO FAÇA

É proibido:

- colocar segredo no frontend;
- usar service role no navegador;
- confiar em `localStorage` como mecanismo de autorização;
- confiar em role fornecida pelo cliente;
- permitir `SELECT *` indiscriminado de dados sensíveis;
- criar bypass administrativo escondido;
- apagar logs históricos de acesso;
- armazenar PIN em texto puro;
- armazenar biometria de forma pública;
- inventar protocolo de fabricante;
- assumir que hardware sempre está online;
- usar IA generativa para liberar porta;
- afirmar conformidade normativa sem validação;
- declarar certificação que não existe;
- misturar ponto com controle de acesso;
- misturar central de vigilância com software de acesso;
- criar dependência obrigatória do Zela Escola;
- fazer alterações no Zela Escola sem ordem explícita;
- criar funcionalidades “de mentira” apenas para deixar o dashboard bonito;
- usar dados mockados no caminho real de produção.

---

# 61. DOCUMENTAÇÃO OBRIGATÓRIA

Antes de implementar a maior parte do produto, crie/atualize:

```text
README.md
CLAUDE.md

docs/00-PROJECT-CHARTER.md
docs/01-SYSTEM-AUDIT.md
docs/02-REQUIREMENTS.md
docs/03-DOMAIN-MODEL.md
docs/04-ARCHITECTURE.md
docs/05-SECURITY.md
docs/06-LGPD.md
docs/07-REGULATORY-MATRIX.md
docs/08-HARDWARE-INTEGRATION.md
docs/09-OFFLINE-FIRST.md
docs/10-ACCESS-EVIDENCE.md
docs/11-API.md
docs/12-E2E-SCENARIOS.md
docs/13-DISASTER-RECOVERY.md
docs/14-THREAT-MODEL.md
docs/15-TEST-PLAN.md
docs/16-DEPLOYMENT.md
docs/17-OPERATIONS.md
docs/18-COMPLIANCE-CHECKLIST.md
docs/19-DECISIONS.md
docs/20-ROADMAP.md
```

> **Emenda R1 (gap B-docs).** Situação em 06/10/2026 e momento de criação (cada documento nasce quando a fase o exige, não em bloco vazio):
>
> | Situação | Documentos |
> |---|---|
> | Existem | 01, 03, 04, 07, 14, 15, 19, 20, `ZELA_ACESSO_STATUS.md`, `ZELA_ACESSO_LOCAL_ENV.md`, README, CLAUDE.md |
> | Incorporado a este documento | 02 (Anexo C) |
> | Criar já | `ZELA_ACESSO_SKILLS.md` (§0.1.8) |
> | Criar na Fase 2 | `CONTRIBUTING.md`, `SECURITY.md`, `05-SECURITY.md`, `16-DEPLOYMENT.md` (§0.2.16) |
> | Criar na Fase 3 | `10-ACCESS-EVIDENCE.md`, `11-API.md` |
> | Criar na Fase 4 | `08-HARDWARE-INTEGRATION.md`, `09-OFFLINE-FIRST.md` |
> | Criar até a Fase 9 | `00-PROJECT-CHARTER.md`, `06-LGPD.md` (antes de dados reais), `12-E2E-SCENARIOS.md`, `13-DISASTER-RECOVERY.md`, `17-OPERATIONS.md`, `18-COMPLIANCE-CHECKLIST.md` |
>
> Os docs `04` e `15` ainda citam "TS strict", `zod` e `typecheck`, que a D-017 revogou: atualizar quando forem revisados. Em `19-DECISIONS.md`, D-001 a D-008 seguem "Proposta" apesar de aplicadas, e D-009 está "Pendente" embora `engines` já exija Node ≥ 24: regularizar o status.

---

# 62. REGULATORY MATRIX

Criar uma tabela como:

| Tema | Fonte | Tipo | Requisito | Implementação | Evidência | Status | Responsável |
|---|---|---|---|---|---|---|---|

Status permitidos:

- CONFIRMADO;
- IMPLEMENTADO;
- EM VALIDAÇÃO;
- DEPENDENTE DE NORMA LICENCIADA;
- DEPENDENTE DE CLIENTE;
- DEPENDENTE DE INSTALAÇÃO;
- DEPENDENTE DE PARECER JURÍDICO;
- NÃO APLICÁVEL.

Não utilizar “compliance total” como status simplista.

---

# 63. MODELO DE AMEAÇAS

Criar Threat Model com pelo menos:

- tenant escape;
- account takeover;
- credential theft;
- biometric theft;
- device compromise;
- command injection;
- replay;
- event forgery;
- time manipulation;
- offline cache theft;
- privilege escalation;
- insider threat;
- webhook abuse;
- API abuse;
- malicious installer;
- compromised controller;
- supply-chain attack.

Para cada ameaça:

- probabilidade;
- impacto;
- mitigação;
- detecção;
- resposta;
- risco residual.

> **Emenda R1 (gap B-threat).** O `docs/14-THREAT-MODEL.md` cobre as 17 ameaças, mas **não tem a coluna "risco residual"** (adiada para a Fase 9). Acrescentar a coluna já na próxima revisão, ainda que como "a reavaliar", e **uma coluna "Teste"** ligando cada mitigação ao teste que a comprova (ou "NÃO TESTADO"). Ver também §107.

---

# 64. RECUPERAÇÃO DE DESASTRE

Definir:

- RPO;
- RTO;
- backups;
- teste de restore;
- recuperação do banco;
- recuperação do Storage;
- recuperação do Edge Agent;
- recuperação de credenciais;
- revogação pós-incidente;
- procedimento de comprometimento de tenant.

Não declarar “backup implementado” apenas porque existe backup automático do provedor.

Documentar o que é responsabilidade do provedor e o que é responsabilidade da Arx.

---

# 65. CI/CD

Pipeline mínimo:

```text
commit
 ↓
lint
 ↓
unit tests
 ↓
integration tests
 ↓
security checks
 ↓
build
 ↓
E2E em ambiente apropriado
 ↓
artifact
 ↓
deploy controlado
```

Não permitir deploy automático em produção sem gate de segurança adequado enquanto o produto estiver em fase inicial.

> **Emenda R1 (contradição C-1 resolvida; gap B-CI).** A etapa `typecheck` do texto original foi **removida**: o projeto é JavaScript sem `tsc` (D-017, §7.3); a segurança de tipos vem de testes, RLS e `rbac:drift`. Estado do CI (`.github/workflows/ci.yml`): lint → format → unit → pgTAP (reset limpo) → seed → `rbac:drift` → build → `check:bundle` (varredura de segredos no bundle) → E2E. **Faltam:** (1) etapa de *security checks* de dependências/código (por exemplo `pnpm audit` e uma análise estática compatível com JS), (2) publicação de artefato, (3) gate/aprovação manual de deploy, (4) habilitar o `edge-runtime` do `zela-acesso-local` para testar as funções de ponta a ponta (§0.2.10). Ações do GitHub estão fixadas por tag major e ainda **não verificadas** (pinar por SHA ao endurecer o pipeline).

---

# 66. MIGRATIONS

Migrations devem ser:

- incrementais;
- idempotentes quando possível;
- revisáveis;
- nunca editar migration já aplicada em produção;
- acompanhar rollback quando aplicável;
- testadas em banco limpo;
- testadas em banco com dados semelhantes a produção.

---

# 67. DADOS DE TESTE

Criar seed seguro para desenvolvimento.

Nunca colocar:

- CPF real;
- foto real;
- biometria real;
- API key real;
- cartão real;
- senha real;
- token real.

---

# 68. AMBIENTES

Separar:

```text
local
 ↓
development
 ↓
staging
 ↓
production
```

Cada ambiente deve possuir credenciais próprias.

Nunca reutilizar secret de produção em desenvolvimento.

> **Emenda R1 (gap B-ambientes).** Estado real: **local** (Supabase isolado `zela-acesso-local`) e **staging** (Supabase remoto sa-east-1, hoje vazio de dados reais). O deploy "de produção" do front na Vercel consome o Supabase de **staging**, o que é provisório; **não existe** um ambiente de produção. Regras: (1) não tratar o staging como produção nem inserir dados reais nele antes de MFA (§35), retenção/LGPD (§44) e `docs/16-DEPLOYMENT.md`; (2) criar produção com credenciais próprias apenas por decisão do dono; (3) separar a configuração de produção do `config.toml` local (§0.2.16); (4) remover chaves administrativas injetadas pela integração da Vercel que o front não usa, e o projeto Vercel duplicado, mediante aval do dono.

---

# 69. ESTRATÉGIA DE DESENVOLVIMENTO POR FASES

## FASE 0 — DESCOBERTA E AUDITORIA

Não codificar ainda.

Entregar:

- diagnóstico do repositório;
- ambiente;
- dependências;
- arquitetura proposta;
- riscos;
- matriz regulatória;
- domínio;
- ERD preliminar;
- ameaça preliminar;
- plano de desenvolvimento.

## FASE 1 — FUNDATION

Implementar:

- estrutura de projeto modular compatível com a organização do Zela Escola;
- tooling;
- CI;
- Supabase;
- Auth;
- tenants;
- organizações;
- RBAC;
- RLS;
- observabilidade;
- base de UI.

## FASE 2 — DOMÍNIO PRINCIPAL

Implementar:

- sites;
- buildings;
- zones;
- people;
- groups;
- credentials;
- access points;
- schedules;
- policies.

## FASE 3 — MOTOR DE ACESSO

Implementar:

- Access Decision Engine;
- códigos de motivo;
- Access Evidence;
- eventos;
- auditoria;
- anti-passback.

## FASE 4 — EDGE

Implementar:

- enrollment;
- heartbeat;
- cache;
- offline policy;
- queue;
- synchronization;
- idempotency;
- device commands.

## FASE 5 — VISITANTES

Implementar:

- convites;
- QR/token;
- check-in;
- check-out;
- expiração;
- escopo por zona.

## FASE 6 — ALERTAS E OPERAÇÃO

Implementar:

- dashboard operacional;
- alertas;
- incidentes;
- porta forçada;
- porta aberta;
- dispositivos offline;
- ocupação.

## FASE 7 — BIOMETRIA

Somente depois da fundação de segurança.

Implementar via provider abstraction.

## FASE 8 — HARDWARE REAL

Começar com um adapter/documentação de fabricante realmente disponível.

Não tentar suportar 20 fabricantes simultaneamente.

## FASE 9 — HARDENING

- segurança;
- performance;
- RLS;
- observabilidade;
- testes;
- threat model;
- incident response;
- backup/restore.

## FASE 10 — PILOTO

Criar ambiente de piloto controlado.

Testar em condições reais.

## FASE 11 — RELEASE CANDIDATE

Somente após os critérios de aceite.

> **Emenda R1 — gates adicionais por fase** (derivados dos gaps A/B; detalhe no Anexo B):
>
> | Fase | Gate adicional |
> |---|---|
> | 2 | `tenants.timezone` (§43); `buildings`/`floors` opcionais antes de `access_points` (§23); `packages/security` com hash de PIN; `CONTRIBUTING.md`, `SECURITY.md`, `05`, `16` |
> | 3 | Colunas novas do `audit_log` (§33) **antes** do gate; contratos (`packages/contracts`, HAL em `packages/device-drivers`); `10`, `11` |
> | 4 | `apps/edge-agent`; Mock Hardware Adapter (§0.2.13); `edge-runtime` no wrapper/CI (§0.2.10); rate limit nas funções (§34); `08`, `09` |
> | antes de dados reais / piloto | MFA exigido (`aal2`, §35); `retention_policy`, `data_subject_request`, `consent_record` + `06-LGPD.md` (§44); Storage privado por tenant (§36); ambiente de produção separado (§68) |
> | 9 | Risco residual e coluna "Teste" no threat model (§63, §107); checkpoint formal de segurança (§70) |
>
> Estado atual das fases: ver `docs/ZELA_ACESSO_STATUS.md`.

---

# 70. CHECKPOINTS OBRIGATÓRIOS

Ao terminar cada fase:

1. execute os testes;
2. revise alterações;
3. verifique migrations;
4. verifique RLS;
5. atualize documentação;
6. registre riscos;
7. registre o que ficou pendente;
8. produza resumo técnico;
9. só então avance.

Não acumule centenas de alterações sem checkpoint.

---

# 71. GIT

Usar commits pequenos e semanticamente compreensíveis.

Exemplos:

```text
feat(domain): create access policy engine
feat(edge): add offline event queue
feat(visitor): create visitor lifecycle
fix(security): enforce tenant isolation
fix(device): make command idempotent
test(access): add anti-passback coverage
docs(compliance): update regulatory matrix
```

Nunca fazer um único commit gigantesco com tudo.

---

# 72. CRITÉRIO DE PARADA

Se você encontrar uma decisão cuja resposta possa causar:

- risco jurídico;
- risco de segurança física;
- risco de vazamento de dados;
- risco de perda de isolamento multi-tenant;
- risco de abertura indevida de porta;
- risco de impedir evacuação;
- risco de corrupção do histórico;
- risco de compliance falso;

pare o desenvolvimento daquela parte, documente a incerteza e resolva por pesquisa/validação antes de implementar.

Não “chute” em assuntos críticos.

---

# 73. REGRA CONTRA FALSA CONFORMIDADE

Nunca escrever no sistema ou documentação comercial:

- “homologado pela ANPD”;
- “certificado pela Polícia Federal”;
- “certificado ABNT”;
- “100% em conformidade com todas as normas”;
- “legalmente garantido”.

Apenas registrar o que foi efetivamente validado.

---

# 74. CHECKLIST DE SEGURANÇA FÍSICA

Para cada tipo de ponto de acesso, modelar:

- sentido de entrada;
- sentido de saída;
- comportamento normal;
- comportamento offline;
- comportamento em falta de energia;
- comportamento em emergência;
- sensor;
- relé;
- tempo de abertura;
- timeout;
- fallback manual;
- responsável;
- risco.

O software não deve assumir que todos os tipos de fechadura têm o mesmo comportamento seguro.

---

# 75. CHECKLIST DE HARDWARE PILOTO

Para o primeiro piloto, escolher deliberadamente:

1. um fabricante com API/SDK/documentação disponível;
2. uma controladora;
3. um leitor;
4. uma fechadura/relé;
5. um sensor de porta;
6. um método de identificação;
7. uma máquina Windows ou Linux para Edge Agent.

Criar adapter real.

Depois documentar:

- instalação;
- configuração;
- pareamento;
- credenciais;
- teste online;
- teste offline;
- teste de reinício;
- teste de falha;
- recuperação.

---

# 76. RESULTADO ESPERADO DA PRIMEIRA EXECUÇÃO DO CLAUDE CODE

Na primeira execução deste prompt, antes de construir grande quantidade de código, entregue no próprio repositório:

### 1. `docs/01-SYSTEM-AUDIT.md`
Diagnóstico completo do ambiente.

### 2. `docs/02-REQUIREMENTS.md`
Requisitos funcionais e não funcionais.

### 3. `docs/04-ARCHITECTURE.md`
Arquitetura proposta.

### 4. `docs/07-REGULATORY-MATRIX.md`
Matriz regulatória baseada em fontes verificadas.

### 5. `docs/14-THREAT-MODEL.md`
Threat model inicial.

### 6. `docs/03-DOMAIN-MODEL.md`
Modelo de domínio.

### 7. `docs/15-TEST-PLAN.md`
Plano de testes.

### 8. `docs/20-ROADMAP.md`
Roadmap técnico por fases.

### 9. `docs/19-DECISIONS.md`
Decisões arquiteturais e suas justificativas.

### 10. `CLAUDE.md`
Instruções permanentes do projeto.

Depois disso, inicie a FASE 1.

> **Emenda R1.** Entregue e aprovado pelo dono em 06/10/2026. O item 2 (requisitos) passou a viver no Anexo C deste documento; o item 10 (`CLAUDE.md`) passou a ser apenas memória e economia de tokens (§0.0).

---

# 77. FORMATO OBRIGATÓRIO DOS RELATÓRIOS DE PROGRESSO

Ao concluir cada fase, gere relatório com:

```text
FASE:

OBJETIVO:

IMPLEMENTADO:

ARQUIVOS PRINCIPAIS:

BANCO / MIGRATIONS:

RLS:

TESTES:

SEGURANÇA:

COMPLIANCE:

DECISÕES:

RISCOS:

PENDÊNCIAS:

PRÓXIMA FASE:

STATUS:
```

Não diga “tudo certo” sem evidência.

---

# 78. REGRA DE HONESTIDADE TÉCNICA

Você deve diferenciar:

```text
IMPLEMENTADO
TESTADO
VALIDADO
VERIFICADO
NÃO TESTADO
PENDENTE
HIPÓTESE
```

Nunca trate “implementado” como sinônimo de “validado em produção”.

---

# 79. PERFORMANCE

Evitar:

- polling agressivo;
- consultas repetidas;
- subscription indiscriminada;
- carregamento de todo histórico;
- imagens gigantes;
- processamento biométrico desnecessário;
- joins caros sem índices.

O sistema deve suportar milhares de eventos sem degradar a interface.

---

# 80. CUSTO DE INFRAESTRUTURA

A Arx é uma empresa em fase inicial.

As decisões devem equilibrar:

- segurança;
- escalabilidade;
- custo;
- simplicidade operacional.

Não introduzir Kubernetes, Kafka, Redis, Elasticsearch ou dezenas de serviços apenas porque são tecnologicamente possíveis.

Primeiro provar que há necessidade real.

Supabase/PostgreSQL + Edge Functions + Edge Agent podem ser suficientes inicialmente.

Escalar arquitetura somente quando métricas justificarem.

---

# 81. PRINCÍPIO DE EVOLUÇÃO

O MVP deverá ser pequeno em quantidade de módulos, mas profundo em qualidade.

Preferir:

> 10 módulos muito bem implementados

em vez de:

> 30 módulos superficiais.

---

# 82. CRITÉRIO PARA NOVAS FUNCIONALIDADES

Antes de adicionar qualquer funcionalidade futura, responda:

1. É realmente necessária?
2. É parte do domínio de controle de acesso?
3. Existe exigência legal/normativa?
4. Existe demanda comercial?
5. Aumenta risco?
6. Aumenta custo?
7. Pode ser integrada sem acoplamento?
8. Deve estar no MVP ou backlog?

---

# 83. PREPARAÇÃO PARA COMERCIALIZAÇÃO

Criar arquitetura para:

- planos;
- limites por plano;
- quantidade de pessoas;
- quantidade de unidades;
- quantidade de pontos;
- quantidade de dispositivos;
- recursos habilitados;
- logs/retencão;
- visitantes;
- biometria;
- integrações.

Não precisa implementar cobrança completa no MVP se isso prejudicar o produto principal.

Mas o modelo deve nascer preparado para SaaS comercial.

---

# 84. WHITE-LABEL FUTURO

O produto poderá futuramente permitir marca do cliente.

Não colocar white-label completo no MVP.

Mas não hardcode:

- nome Zela;
- cores fixas;
- logos diretamente em dezenas de componentes.

Criar sistema de branding centralizado.

---

# 85. INTERNACIONALIZAÇÃO FUTURA

Embora o MVP seja Brasil-first, evitar estruturas que impossibilitem:

- idioma;
- timezone;
- formato de data;
- moeda;
- endereço;
- documentos.

Não implementar múltiplos países agora.

---

# 86. RELAÇÃO COM O ZELA ESCOLA

O Zela Escola é produto separado.

Não fazer:

```text
Zela Acesso depende do banco do Zela Escola
```

Preferir:

```text
Zela Escola
      ↕
   API/Eventos
      ↕
Zela Acesso
```

Futuro:

```text
Zela Escola
   └── integração de pessoas/autorizados

Zela Acesso
   └── controle físico

Zela Ponto
   └── jornada
```

---

# 87. RELAÇÃO COM O ZELA PONTO

O Zela Ponto será produto separado.

O Zela Acesso poderá gerar eventos de passagem.

O Zela Ponto poderá consumir esses eventos.

Mas o Zela Acesso nunca deve considerar que:

> “entrou na catraca = bateu ponto”.

Uma integração futura deve permitir:

```text
Zela Acesso
access.granted
      ↓
Integration Layer
      ↓
Zela Ponto
possible time event
```

A interpretação jurídica/trabalhista fica no Zela Ponto.

---

# 88. PRIMEIRO HARDWARE REAL

Não desenvolva uma camada de drivers abstrata infinita sem testar hardware real.

Após a fundação do software:

1. selecionar hardware comercial realmente disponível no Brasil;
2. estudar documentação oficial;
3. criar adapter;
4. testar em laboratório;
5. documentar limitações;
6. criar testes de integração;
7. somente então expandir fabricantes.

---

# 89. TESTE DE CAMPO

Antes de produção comercial:

### Cenários obrigatórios

- internet normal;
- internet lenta;
- internet indisponível;
- energia normal;
- reinício do controlador;
- reinício do Edge Agent;
- leitor indisponível;
- sensor aberto;
- porta forçada;
- credencial revogada;
- política alterada;
- visitante expirado;
- anti-passback;
- emergência;
- múltiplos acessos simultâneos;
- relógio incorreto;
- eventos duplicados;
- sincronização após longo período offline.

---

# 90. DADOS DE PRODUÇÃO

Nenhuma funcionalidade crítica deve chegar ao primeiro cliente baseada em:

- mock;
- fake API;
- `setTimeout` fingindo hardware;
- status inventado;
- eventos gerados artificialmente no caminho real.

Mocks são permitidos apenas em testes e desenvolvimento.

---

# 91. REGRA PARA COMPONENTES DE HARDWARE NÃO DISPONÍVEIS

Quando um hardware ainda não estiver integrado:

- crie interface;
- crie adapter fake apenas para testes;
- marque integração como PENDING;
- documente fabricante/protocolo necessário;
- não apresente como “suportado”.

---

# 92. SEGURANÇA DE COMANDOS FÍSICOS

Qualquer comando como:

```text
OPEN_DOOR
LOCK_DOOR
UNLOCK_DOOR
TRIGGER_RELAY
EMERGENCY_UNLOCK
```

deve possuir:

- autorização;
- escopo;
- tenant;
- ponto;
- actor;
- motivo quando aplicável;
- idempotência;
- timestamp;
- auditoria;
- confirmação de recebimento quando possível;
- proteção contra replay.

Não permitir comando físico usando apenas ID de objeto fornecido pelo frontend.

---

# 93. DISPOSITIVOS COMPROMETIDOS

Criar conceito de:

```text
TRUSTED
SUSPECT
REVOKED
```

Um dispositivo revogado não deve receber comandos privilegiados.

---

# 94. ACCESS EVIDENCE E ASSINATURA

Avaliar tecnicamente a possibilidade de hash encadeado ou assinatura de eventos.

Objetivo:

> detectar adulteração posterior.

Não declarar valor jurídico de uma assinatura sem validação jurídica.

O mecanismo é de integridade técnica e auditoria.

---

# 95. INCIDENT RESPONSE

Criar fluxo:

```text
Detecção
 ↓
Classificação
 ↓
Contenção
 ↓
Preservação de evidências
 ↓
Investigação
 ↓
Mitigação
 ↓
Comunicação
 ↓
Recuperação
 ↓
Lições aprendidas
```

Criar documentação para incidentes de:

- vazamento;
- conta comprometida;
- device comprometido;
- fraude de credencial;
- acesso indevido;
- perda de integridade dos logs.

---

# 96. PRIVACIDADE POR PADRÃO

Defaults devem favorecer privacidade.

Exemplos:

- biometria desligada até configuração;
- buckets privados;
- menor retenção razoável;
- mínimo de dados coletados;
- logs sem dados sensíveis desnecessários;
- exportação restrita;
- auditoria ativa;
- MFA para administradores.

---

# 97. TELEMETRIA

A Arx pode precisar de telemetria técnica para operar a plataforma.

Separar:

### Telemetria técnica

- versão do agent;
- uptime;
- CPU/memória quando tecnicamente necessário;
- estado do dispositivo;
- erro;
- latência.

### Dados pessoais

- pessoa;
- acesso;
- biometria;
- visitante.

Nunca coletar dados pessoais apenas porque “pode ser útil para analytics”.

---

# 98. SUPORTE

Criar mecanismos que permitam suporte sem acesso irrestrito aos dados do cliente.

Preferir:

- diagnósticos agregados;
- health check;
- logs técnicos sanitizados;
- suporte delegado temporariamente;
- auditoria de acesso administrativo;
- acesso just-in-time quando possível.

> **Emenda R1 (gap B-suporte).** Estado: `platform_support` lê, por padrão, logs técnicos, chat de suporte e **cadastro da organização** (dados da empresa, sem preços/contratos), mas não dados de pessoas (apenas contagens agregadas). Isso é aceito pelo dono. Pendências para alinhar ao §56 e ao `14-THREAT-MODEL`: (1) **registrar em auditoria** cada leitura de dado de organização por `platform_support`; (2) pgTAP provando que `platform_support` **não** lê pessoas, credenciais, eventos ou biometria de nenhum tenant; (3) quando houver dados de pessoas/eventos, acesso apenas por mecanismo delegado temporário (JIT) e auditado.

---

# 99. PLANO DE ROLLOUT

Não implantar diretamente em centenas de clientes.

Estratégia:

```text
Laboratório
 ↓
Piloto interno
 ↓
1 cliente
 ↓
2–5 clientes
 ↓
Escala controlada
 ↓
Produção ampla
```

Cada etapa deve ter critérios de saída.

---

# 100. PRIMEIRO CLIENTE PILOTO

Como existe intenção de utilizar o produto em cliente real, o piloto deve ser tratado como ambiente de validação.

Criar:

- checklist pré-instalação;
- checklist de implantação;
- checklist de segurança;
- checklist de privacidade;
- checklist de hardware;
- checklist de treinamento;
- checklist de suporte;
- checklist de rollback.

---

# 101. ROLLBACK

Qualquer release que controle hardware deve possuir plano de rollback.

O rollback do software não pode simplesmente interromper o acesso físico.

O Edge Agent deve manter comportamento seguro durante atualização/falha.

---

# 102. ATUALIZAÇÃO DO EDGE AGENT

Planejar:

- versionamento;
- compatibilidade de schema;
- migração local;
- rollback de versão;
- assinatura/verificação do pacote;
- integridade;
- health check pós-update;
- possibilidade de suspensão do rollout.

---

# 103. DOCUMENTAÇÃO PARA INSTALADOR

Produzir futuramente:

- guia de instalação;
- guia de rede;
- guia de firewall;
- guia de credenciais;
- guia de controlador;
- guia de sensor;
- guia de testes;
- troubleshooting;
- procedimento de troca;
- procedimento de rollback.

---

# 104. DOCUMENTAÇÃO PARA CLIENTE

Produzir futuramente:

- manual do administrador;
- manual da recepção;
- manual do gestor;
- política de privacidade;
- termos;
- matriz de permissões;
- guia de visitantes;
- política de retenção;
- procedimentos de emergência.

O software não deve inventar documentos jurídicos. Templates deverão ser claramente identificados como modelos sujeitos a validação.

---

# 105. CRITÉRIO DE QUALIDADE VISUAL

A interface deve passar a sensação de:

- segurança;
- confiabilidade;
- tecnologia;
- precisão;
- controle;
- simplicidade operacional.

Evitar:

- exagero de gradientes;
- excesso de animação;
- dashboards genéricos;
- excesso de cards;
- microinterações irrelevantes.

---

# 106. PRINCÍPIO DE OBSERVABILIDADE DOS ACESSOS

Uma das características mais importantes do produto será permitir investigar:

> “O que aconteceu?”

de forma rápida.

A partir de um incidente, o operador deve conseguir chegar a:

```text
Pessoa
 ↓
Credencial
 ↓
Tentativa
 ↓
Decisão
 ↓
Política
 ↓
Porta
 ↓
Controlador
 ↓
Estado
 ↓
Resultado físico
 ↓
Auditoria
```

---

# 107. MATRIZ DE RISCO DO PRODUTO

Criar matriz:

| Risco | Probabilidade | Impacto | Severidade | Mitigação | Teste |
|---|---:|---:|---:|---|---|

Incluir pelo menos:

- abertura indevida;
- bloqueio indevido;
- indisponibilidade;
- vazamento biométrico;
- tenant escape;
- fraude de credencial;
- replay;
- alteração de histórico;
- comprometimento de device;
- falha de sincronização;
- erro de horário;
- configuração de emergência incorreta.

> **Emenda R1.** Esta matriz **ainda não existe** como documento. O `14-THREAT-MODEL.md` cobre a maior parte dos riscos listados, mas não tem as colunas "Severidade" e "Teste", e não trata de forma explícita: indisponibilidade, fraude de credencial como risco de produto, falha de sincronização e configuração de emergência incorreta. Criá-la como seção do `14-THREAT-MODEL.md` (ou `18-COMPLIANCE-CHECKLIST.md`) até a Fase 9.

---

# 108. REGRA DE SIMPLICIDADE

Se uma solução simples resolver com segurança, prefira a simples.

Não introduzir complexidade distribuída apenas para parecer “enterprise”.

A arquitetura deve ser:

> simples o suficiente para uma equipe pequena manter, robusta o suficiente para crescer.

---

# 109. PRIMEIRA PRIORIDADE TÉCNICA

A primeira parte realmente crítica a construir depois da fundação é:

### Access Decision Engine

Porque ele define o domínio.

Depois:

### Access Evidence

Depois:

### Edge/offline

Depois:

### Hardware adapter real

Só então ampliar UI.

> **Emenda R1 (orientação B-prioridade).** Entre a Fase 1 e este ponto, foi construído o **Painel do Desenvolvedor** (planos, contratação, suporte com chat, logs de erro, configurações, consulta de CNPJ), por decisão do dono e fora do texto original (Anexo A). Isso não viola o prompt, mas adiou o CRUD da Fase 2 e o vertical slice. Orientação a partir da R1: concluir a Fase 2 (CRUD, credenciais, pontos, janelas, políticas) e chegar ao vertical slice (§112) **antes** de abrir novos módulos fora do escopo deste documento; novos módulos desse tipo pedem aprovação do dono e aplicação do §82.

---

# 110. PRIMEIRA PRIORIDADE DE SEGURANÇA

Antes de dados reais:

1. Auth;
2. RLS;
3. tenant isolation;
4. secrets;
5. audit;
6. storage privado;
7. MFA;
8. rate limits;
9. command authorization;
10. threat model.

---

# 111. PRIMEIRA PRIORIDADE DE PRODUTO

Uma operação completa deve ser possível:

```text
Cadastrar empresa
 ↓
Cadastrar unidade
 ↓
Criar zona
 ↓
Criar ponto
 ↓
Cadastrar pessoa
 ↓
Cadastrar credencial
 ↓
Criar política
 ↓
Tentar acesso
 ↓
Decidir
 ↓
Abrir porta
 ↓
Registrar evento
 ↓
Criar evidência
 ↓
Consultar histórico
```

Esse é o primeiro “vertical slice” obrigatório.

---

# 112. PRIMEIRO VERTICAL SLICE

Não implementar 20 telas sem ter esse fluxo funcionando ponta a ponta.

O primeiro vertical slice deverá funcionar de verdade em ambiente de desenvolvimento:

```text
Web
 ↓
API/Backend
 ↓
Motor de decisão
 ↓
Persistência
 ↓
Edge Agent
 ↓
Mock Hardware Adapter
 ↓
Evento físico simulado
 ↓
Sync
 ↓
Access Evidence
```

Depois substituir o Mock Hardware Adapter por hardware real.

---

# 113. DEFINIÇÃO DO MVP

O MVP não significa produto simplificado de forma insegura.

Significa:

> menor conjunto comercialmente útil que prove a tese do produto.

MVP obrigatório:

- multi-tenant;
- RBAC;
- pessoas;
- credenciais;
- zonas;
- pontos;
- políticas;
- horários;
- anti-passback;
- visitantes;
- eventos;
- Access Evidence;
- auditoria;
- alertas básicos;
- dashboard;
- Edge Agent;
- offline;
- integração de pelo menos um caminho de hardware;
- segurança/LGPD por design.

---

# 114. FORA DO MVP

- IA generativa de decisão;
- LPR avançado;
- VMS completo;
- reconhecimento de emoções;
- vigilância autônoma;
- central de monitoramento profissional Arx;
- resposta de segurança;
- controle trabalhista de ponto;
- folha;
- ERP;
- automação residencial genérica;
- suporte nativo a dezenas de marcas simultaneamente.

---

# 115. SAÍDA FINAL ESPERADA DO PROJETO

Ao chegar ao Release Candidate, o repositório deverá conter:

- código limpo;
- testes;
- migrations;
- documentação;
- matriz regulatória;
- threat model;
- checklist de segurança;
- checklist de implantação;
- Edge Agent funcional;
- adapter de hardware real;
- dashboard;
- Access Evidence;
- audit trail;
- APIs;
- webhooks;
- CI/CD;
- scripts de deploy;
- scripts de seed;
- procedimento de backup/restore;
- instruções de operação.

---

# 116. COMANDO INICIAL

Ao receber este prompt, execute exatamente nesta ordem:

## PASSO 1 — INSPECIONAR

Analise o ambiente e o repositório.

## PASSO 2 — PESQUISAR

Verifique as fontes oficiais atuais necessárias, principalmente LGPD/ANPD, legislação federal, normas técnicas aplicáveis e documentação oficial dos componentes escolhidos.

## PASSO 3 — DOCUMENTAR

Crie a auditoria e a arquitetura preliminar.

## PASSO 4 — IDENTIFICAR RISCOS

Crie threat model inicial e matriz regulatória.

## PASSO 5 — VALIDAR ARQUITETURA

Verifique se a solução atende simultaneamente:

- segurança;
- escalabilidade;
- offline;
- hardware;
- multi-tenancy;
- LGPD;
- auditabilidade;
- custo razoável;
- manutenção por equipe pequena.

## PASSO 6 — IMPLEMENTAR FUNDAÇÃO

Só então comece a codificar.

## PASSO 7 — VERTICAL SLICE

Complete o primeiro fluxo ponta a ponta.

## PASSO 8 — TESTAR

Teste profundamente antes de ampliar.

## PASSO 9 — AVANÇAR POR FASES

Nunca avance ignorando falhas críticas.

> **Emenda R1.** Os Passos 1–5 e a Fase 1 já foram cumpridos e aprovados pelo dono; a Fase 2 está em andamento. Este §116 é o roteiro de **uma sessão inicial**, não uma instrução para repetir a Fase 0 a cada tarefa: para retomar o trabalho, ler `docs/ZELA_ACESSO_STATUS.md`.

---

# 117. COMANDO FINAL AO CLAUDE CODE

> **Comece agora. Não faça perguntas que possam ser resolvidas por inspeção, pesquisa, inferência técnica segura ou documentação oficial. Primeiro analise o ambiente e produza a documentação da FASE 0. Não faça uma implementação superficial só para mostrar progresso. Priorize corretude, segurança, isolamento multi-tenant, funcionamento offline, integridade dos eventos, auditabilidade, privacidade e capacidade real de integração com hardware.**
>
> **Sempre que houver conflito entre velocidade e segurança, priorize segurança. Sempre que houver conflito entre aparência e funcionalidade real, priorize funcionalidade real. Sempre que houver incerteza normativa, pesquise a fonte oficial e registre a incerteza; não invente. Sempre que houver dúvida arquitetural importante, apresente a decisão documentada antes de consolidá-la.**
>
> **Não considere uma fase concluída porque “funciona no navegador”. Considere concluída somente quando o código, banco, segurança, testes, observabilidade, documentação e critérios de aceite daquela fase estiverem atendidos.**
>
> **O objetivo não é criar uma demonstração. O objetivo é construir a fundação de um produto comercial de controle de acesso físico que possa evoluir para operação nacional pela Arx Tecnologia.**

---

# 118. REFERÊNCIAS OFICIAIS INICIAIS PARA CONSULTA

As URLs abaixo são pontos de partida e devem ser revalidadas no momento da implementação:

- Lei nº 14.967/2024 — Estatuto da Segurança Privada:
  https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2024/lei/l14967.htm

- ANPD — regulamentações:
  https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd

- ANPD — comunicação de incidente:
  https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis

- ANPD — ECA Digital:
  https://www.gov.br/anpd/pt-br/assuntos/eca-digital/

- Ministério do Trabalho — NR-23:
  https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadora/normas-regulamentadoras-vigentes/norma-regulamentadora-no-23-nr-23

- IEC 60839-11-1:
  https://webstore.iec.ch/en/publication/3662

- IEC 60839-11-2:
  https://webstore.iec.ch/en/publication/3663

> **Emenda R1.** Lacunas regulatórias abertas (ver `docs/07-REGULATORY-MATRIX.md`): Lei 14.967 não verificada no Planalto (acesso falhou) — ler antes da Fase 6; Guia ANPD de Biometria e Nota Técnica 4/2026 não lidos na íntegra — ler antes da Fase 7; NR-23 (itens de saída) e ITs do CBM da UF do piloto — obter antes da Fase 8.

---

# 119. REGRA FINAL DE GOVERNANÇA DO PROJETO

O Zela Acesso poderá evoluir para um produto muito maior do que este MVP.

Não destruir essa possibilidade criando atalhos estruturais hoje.

A arquitetura deve permitir:

```text
                      ARX TECNOLOGIA
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   ZELA ESCOLA         ZELA PONTO         ZELA ACESSO
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                  Integrações / APIs
                            │
                   Plataforma Arx futura
```

Mas, por enquanto, o Zela Acesso deve permanecer um produto independente, com seu próprio domínio técnico e comercial.

**Construa corretamente desde a fundação. Não transforme o MVP em um sistema monolítico difícil de separar depois.**

---

# ANEXO A — ESTADO E DECISÕES DO DONO QUE PREVALECEM SOBRE O TEXTO (R1)

Resumo estável; o **estado vivo** está em `docs/ZELA_ACESSO_STATUS.md` e as decisões formais em `docs/19-DECISIONS.md`.

| Tema | Decisão vigente | Origem |
|---|---|---|
| Linguagem | JavaScript/JSX, sem TypeScript; contratos com JSDoc; Edge Functions em Deno; Edge Agent em Node (a validar) | D-017, D-005 |
| Estrutura | Monorepo pnpm (`apps/web`, `packages/domain`, …), confirmado pelo §8 | D-001 |
| Supabase local | `project_id = zela-acesso-local`, portas 553xx, sem modo `stack` (CLI 2.109.1 < 2.119) | D-002 |
| Skills | Instaladas: skill-security-scan, adversarial-verify, context-warden. Dispensadas: supabase, postgres-best-practices, playwright-skill, security-audit | D-011 |
| Cadastro | Cadastro público desligado; usuários entram por convite/seed/criação pela plataforma | D-015 |
| Autorização | Via `has_permission` no banco; sem papéis em claims do JWT | D-014 |
| MFA | TOTP habilitado, ainda não exigido → ver §35 | D-016 |
| Nomenclatura | "Janelas de acesso" no lugar de "Horários" | commit fca5551 |
| Painel do Desenvolvedor | Escopo adicional ao prompt (menu da plataforma: Gestão de Organizações, Planos, Faturamento "em breve", Logs, Biometria, Suporte, Configurações), tema claro, paridade parcial com o portal do Zela Escola | decisão do dono |
| Diferenças deliberadas no painel | Sem "Excluir" definitivo (só suspender/reativar); sem "Explicar com IA" nos logs; sem busca de CEP externa; senha do responsável ≥ 8 caracteres; mensagens do banco nunca exibidas cruas; limites contratados são só registro, não aplicados | decisão do dono |
| Dados comerciais | Preços do catálogo nascem 0 e não há planos; a Arx os define no menu Planos | decisão do dono |
| Terceiros | `lookup-cnpj` consulta a API aberta `open.cnpja.com` (CNPJ é dado público de PJ; descarta sócios e dados pessoais) | decisão do dono |
| Infra remota | Staging Supabase (sa-east-1), GitHub `paulocaique98-create/Zela-Acesso`, Vercel `zela-acesso.`; operações remotas só com autorização explícita | §0.2.16, §68 |

Fases: Fase 0 aprovada em 06/10/2026; Fase 1 implementada e testada localmente; Fase 2 em andamento (2A banco pronto; telas e 2B–2D pendentes). **Não** reabrir a Fase 0.

---

# ANEXO B — BACKLOG ESTRUTURAL DERIVADO DA COMPARAÇÃO PROMPT × CÓDIGO (R1)

Itens que afetam diretamente a estrutura do código (banco, pacotes, scripts). Os ajustes **não foram executados** na R1; cada um tem fase/gate. Marcar como concluído somente com evidência no STATUS.

| ID | Mudança | Onde no texto | Fase / gate | Depende de decisão do dono? |
|---|---|---|---|---|
| A-1 | `buildings`/`floors` opcionais; `building_id`/`floor_id` anuláveis em `zones` | §23 | Fase 2C, antes de `access_points` | Sim: obrigatório ou opcional (recomendado: opcional) |
| A-2 | Colunas de `audit_log`: `actor_type`, `before`, `after`, `reason`, `ip`, `user_agent`, `correlation_id` (migration aditiva) | §33 | Antes do gate da Fase 3 | Não |
| A-3 | Criar `packages/security`, `contracts`, `device-drivers`, `apps/edge-agent` sob demanda | §8 | 2B / 3 / 4 | Não |
| A-4 | Habilitar `edge-runtime` do `zela-acesso-local` no wrapper e no CI; teste ponta a ponta das funções | §0.2.10, §65 | Antes de publicar qualquer função | Não |
| A-5 | MFA exigido (`aal2`) em `has_permission`/policies para papéis administrativos + fluxo na web | §35 | Antes de dados reais / piloto | Sim (D-016: quais papéis) |
| A-6 | Contrato HAL + Mock Hardware (Fase 4); `BiometricProvider` + Mock (Fase 7) | §0.2.13–14 | 3/4/7 | Não |
| A-7 | `retention_policy`, `data_subject_request`, `consent_record` + `06-LGPD.md` | §44–46 | Antes de dados reais; no máximo Fase 9 | Parcial (valores de retenção dependem de parecer jurídico) |
| A-8 | Buckets privados por tenant + policies de Storage + pgTAP | §36 | Com o primeiro upload (Fase 5/7) | Não |
| A-9 | `tenants.timezone` (padrão) herdado pelos sites | §43 | Fase 2B | Não |
| A-10 | Rate limiting nas Edge Functions (Postgres, sem Redis) | §34 | Antes de publicar funções | Não |

Sugestões que **não** afetam a estrutura do código (documentação, processo, CI): ver as emendas de §0.1.8, §0.2.17, §61, §63, §65, §68, §98, §107 e §109.

---

# ANEXO C — REQUISITOS VERIFICÁVEIS (incorporado de `docs/02-REQUIREMENTS.md`, R1)

Mantém os IDs usados no código e nas decisões (por exemplo `RNF-10` em `brand.js`, `RNF-04` em D-016). Detalhe e contexto: seções 10–58 deste documento.

## Funcionais (MVP)

- **RF-01** multi-tenant com hierarquia site/prédio/andar/zona;
- **RF-02** RBAC por recurso + ação + escopo;
- **RF-03** pessoas e grupos;
- **RF-04** credenciais múltiplas (CARD/PIN/QR; FACE depois);
- **RF-05** pontos de acesso com comportamento offline/emergência;
- **RF-06** horários (janelas de acesso), feriados, políticas;
- **RF-07** `evaluateAccess` com códigos de motivo;
- **RF-08** anti-passback soft/hard;
- **RF-09** Access Evidence por tentativa;
- **RF-10** eventos append-only + auditoria;
- **RF-11** visitantes (convite, QR, check-in/out, zonas);
- **RF-12** alertas básicos (porta aberta/forçada, offline, negações repetidas);
- **RF-13** dashboard e presença;
- **RF-14** Edge Agent offline com sync idempotente;
- **RF-15** pelo menos um caminho de hardware real;
- **RF-16** API + webhooks assinados.

## Não funcionais

- **RNF-01** RLS em toda tabela exposta, testada cross-tenant;
- **RNF-02** sem secrets no frontend;
- **RNF-03** Storage privado;
- **RNF-04** MFA para admins em produção (ver §35);
- **RNF-05** decisão local < 500 ms (alvo, a medir);
- **RNF-06** paginação/índices; sem `select *`;
- **RNF-07** logs estruturados com `correlation_id`, sem PIN/token/biometria;
- **RNF-08** UI acessível (teclado, contraste);
- **RNF-09** migrations reproduzíveis e seed 100% sintético;
- **RNF-10** branding centralizado.

## Fora do MVP

IA generativa na decisão, LPR avançado, VMS, central de monitoramento, ponto/folha, dezenas de fabricantes (ver §114).

---

# ANEXO D — CONTRADIÇÕES INTERNAS RESOLVIDAS E REGISTRO DE REVISÃO (R1)

## Contradições do texto original e resolução

| ID | Contradição | Resolução |
|---|---|---|
| C-1 | §65 listava `typecheck` no CI, enquanto o §7 proíbe TypeScript | `typecheck` removido do pipeline (D-017). Segurança de tipos = testes + RLS + `rbac:drift` |
| C-2 | §7.2/§7.4 apontavam `docs/ARCHITECTURE_DECISIONS.md`; o §8 lista `docs/19-DECISIONS.md` | O registro oficial é `docs/19-DECISIONS.md` |
| C-3 | §0.2.4 proíbe `supabase stop`; §0.2.9 usava `npx supabase stop` como fluxo de reset; §0.2.4 citava `supabase down` (comando inexistente) | A proibição vale para chamadas diretas/globais; o ciclo de vida local passa pelo wrapper `scripts/supabase-local.mjs`, que confirma o alvo `zela-acesso-local` |
| C-4 | §69 diz que a Fase 0 "não codifica", mas o checklist do §0.2.17 exigia Mock Hardware e Mock Biométrico funcionando | O checklist da Fase 0 cobre só o ambiente; mocks entram nas Fases 4 e 7 (§0.2.13, §0.2.14, §0.2.17) |
| C-5 | §0.2.17 pede "Edge Functions localmente testáveis" na saída da Fase 0, mas não há função na Fase 0 | Exigência passa a ser **antes de publicar qualquer função** (§0.2.10) |

## Registro de revisão

- **R0 — 06/10/2026:** versão original entregue pelo dono.
- **R1 — 06/10/2026:** adicionados §0.0, §0.1.8, anexos A–D e as emendas marcadas "Emenda R1"; corrigidos C-1 a C-5; `docs/02-REQUIREMENTS.md` incorporado (Anexo C); grafia "anonymização" → "anonimização". Nenhum requisito original foi removido; as emendas só adicionam prazos, regras de transição e correções de referência. O código e as migrations existentes **não foram alterados** pela R1.

---

# FIM DO PROMPT-MESTRE
