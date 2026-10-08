# 25 — Zela Pass (leitor em tablet/celular)

Data: 08/10/2026. Origem: `24-PONTO-VIRTUAL-PESQUISA.md` e decisões do dono de 08/10/2026 (é **controle de acesso, não ponto**; identificar para **registrar**, não para abrir; nome "Zela Pass"; app web agora, aplicativo nativo depois; telas parecidas em função com as de referência, com a marca Zela).

**Estado:** IMPLEMENTADO e TESTADO em ambiente local (ver §10). Facial **fora** (§9). Nada foi testado em tablet/celular físico, câmera real, TLS real nem Safari/Firefox (§10).

## 1. O que é

Um novo tipo de leitor que roda como **app web instalável (PWA)** em tablet ou celular de portaria (`apps/reader`, pacote `@zela/reader`). Identifica a pessoa por **senha (nº identificador + PIN), QR Code ou código de barras** e **registra entrada/saída**. Não decide nada: envia a leitura ao **Edge Agent**, que avalia com o mesmo `evaluateAccess` de sempre e grava a evidência (fila persistente → nuvem). A atuação (abrir porta/catraca) é opcional e **do ponto**, não do leitor.

```
tablet (PWA)  ──HTTPS / WebSocket (hoje)──►  Edge Agent  ──edge-gateway──►  nuvem (access_events)
app nativo    ──TCP/IP (futuro)───────────►  (mesmo serviço, mesmo protocolo)
```

O Edge serve o próprio PWA (`EDGE_READER_WEB_DIR`): sem conteúdo misto (https da nuvem chamando http da LAN) e o leitor funciona com a internet fora. **Sem Edge na LAN não há leitor** nesta versão (o caminho "direto pela nuvem" previsto na 1ª versão deste documento foi descartado: exigiria o motor completo na Edge Function).

## 2. Conexão: os dois transportes

Mesmo protocolo JSON, mesmo serviço (`apps/edge-agent/src/reader-service.js`), três adaptadores:

| Transporte | Para quê | Onde |
|---|---|---|
| **HTTPS** `POST /reader/v1/message` | PWA (padrão de contingência) | `reader-http-server.js` |
| **WebSocket** `/reader/v1/ws` | PWA (padrão); respostas em ordem, uma por mensagem | `reader-http-server.js` (lib `ws` 8.21.3) |
| **TCP/IP** (NDJSON, uma linha = um envelope, UTF-8) | **aplicativo nativo (projeto futuro)**; o navegador não abre socket TCP bruto | `reader-tcp-server.js` |

O TCP já está **no Edge e testado** (`EDGE_READER_TCP_PORT`); o cliente TCP (app nativo) não existe. Na tela de configurações do PWA a opção "TCP/IP" aparece desabilitada ("disponível no aplicativo nativo").

## 3. Protocolo (`packages/domain/src/reader.js`)

Envelope: `{ v:1, type:'enroll'|'attempt'|'status', readerId, ts, nonce, body, sig }`. `body` vai como **texto JSON** (a assinatura cobre o hash desse texto, sem ambiguidade de serialização). Assinatura Ed25519 sobre `zela-reader/v1\n<type>\n<readerId>\n<ts>\n<nonce>\n<sha256(body)>`.

- **Identidade do aparelho:** par Ed25519 gerado no aparelho (WebCrypto, **privada não extraível**), pública registrada no enroll com prova de posse. Cada mensagem é assinada; nonce de uso único (anti-replay) e janela de relógio de ±120 s (mesma do agente, D-022).
- **Relógio do tablet errado:** o Edge responde `CLOCK_SKEW` com a hora dele; o PWA aprende o desvio e reenvia sozinho (testado até com 30 min de erro). A hora mostrada na tela é a do Edge.
- **Idempotência:** cada leitura leva `deviceEventId`; se a resposta se perder, o reenvio devolve o **mesmo resultado** sem registrar duas vezes (testado ponta a ponta).
- **Respostas de erro** só dizem o necessário: leitor desconhecido, assinatura inválida e corpo adulterado são todos `UNAUTHORIZED`; só depois de assinatura válida o aparelho pode saber `REVOKED`, `CLOCK_SKEW`, `REPLAY`. Ativação recusada é sempre `ENROLL_REJECTED` (código errado, expirado ou já usado: indistinguíveis).
- **Resultado mostrado ao usuário:** só uma categoria (`REGISTERED`, `NOT_AUTHORIZED`, `INVALID_CREDENTIAL`, `CHALLENGE_REQUIRED`, `UNAVAILABLE`), nunca o motivo detalhado (fica na evidência). Senha errada e identificador inexistente dão a **mesma** resposta.
- **Limites:** 30 mensagens/min por leitor (só conta mensagem com assinatura válida, então quem não tem a chave não gasta a cota dele), 300/min por origem antes de autenticar, 10 ativações/min por origem, corpo ≤ 2 KiB (envelope ≤ 8 KiB), bloqueio de PIN por pessoa (5 erros → 5 min, já existente).

## 4. Credenciais (nenhum tipo novo)

| Leitura | Credencial | Observação |
|---|---|---|
| Senha | PIN (hash bcrypt) | Pessoa localizada por `refHash = sha256(tenant:MATRÍCULA normalizada)` (`people.external_ref`); a matrícula em claro não vai ao Edge. Pessoa sem matrícula não usa senha no leitor. **Hipótese a revisar:** matrícula tem pouca entropia; o hash no cache do Edge permite enumerar matrículas a quem roubar o disco (o SQLite é cifrado, `EDGE_STORE_KEY`). |
| QR Code | `mobile_token` (64 hex) | Câmera (`BarcodeDetector`, ou jsQR) ou leitor USB/Bluetooth. |
| Código de barras | cartão/credencial | Code 39, ITF, PDF417, Code 128, EAN-13 **onde o navegador tiver `BarcodeDetector`**; senão, leitor USB/Bluetooth (age como teclado) ou digitar. |

Leitor USB/Bluetooth (teclado): 64 hex = QR/token; qualquer outro valor = cartão/barras.

## 5. Ponto `register_only` e evidência

- `access_points.actuation` = `driver` (padrão, comportamento anterior) | `none` (**somente registro**: sem driver, sem comando, sem `physical_outcome`). Mudança é auditada (`access_points.actuation`). Painel: campo "Modo do ponto".
- Mesmo com ponto `driver`, se o Edge **não** tiver driver instalado o leitor só registra (nunca "abre").
- Evento: continua `access_decision` (decisão do motor) com `evidence.reader = { readerId, method, mode }` (`mode`: `register_only` | `actuate`). Sem tipo de evento novo e sem migration de CHECK. Correção = novo evento (append-only, como sempre). **Nunca** entram PIN, token, número de cartão, matrícula nem nome (testado no Edge, no E2E com banco e no navegador).
- "ALLOW" em ponto `register_only` significa "marcação aceita". Anti-passback, presença local e janelas valem como em qualquer ponto.
- Sem jornada: nenhuma tela, exportação ou texto fala em ponto, horas, atraso ou folha (decisão do dono).

## 6. Banco e permissões (migration `20261107120000_zela_pass_readers.sql`)

`access_readers` (tenant, local, ponto, nome, estado `pending|active|revoked`, hash do código de ativação, chave pública, rótulo). RPCs: `create_access_reader` (devolve o código **uma vez**; 24 h; uso único), `revoke_access_reader` (motivo ≥ 5; irreversível), `edge_report_reader_enrolled` (só `service_role`). Permissões novas `reader:read|create|revoke` (+11 na matriz, 217 → 228; `rbac:drift` limpo): owner/admin todas; security_manager read+revoke; installer read+create; auditor read. O hash do código **não** é legível pela API (grant por coluna). Snapshot do Edge ganhou `actuation` por ponto, `readers` (hash do código só enquanto pendente) e `refHash` por pessoa.

Ativação: o painel cria o leitor e mostra o código (QR + texto); no tablet o operador informa o código; o **Edge** confere o hash (offline), registra a chave pública e **avisa a nuvem** (`reader_enrolled` no gateway) para o painel mostrar "Ativo". Revogação no painel vale quando o Edge receber o snapshot seguinte (**até 5 min**, intervalo de sincronização atual).

## 7. Telas do PWA (função equivalente às de referência; identidade Zela)

Mantém o **fluxo** das 6 telas de referência; marca, paleta (índigo/escuro do Zela), ícones, textos e componentes são próprios. O logotipo é o escudo-check do Zela Acesso + "Zela Pass".

| Tela Zela Pass | Equivalente | Diferenças deliberadas |
|---|---|---|
| **Início:** logo, relógio (hora do Edge) e data, indicadores Edge/nuvem/rede, modo do ponto, botões "QR Code / Barras" e "Teclado", engrenagem, nome do aparelho | Boas-vindas com relógio | Sem botão de facial (módulo desligado). Leitor-teclado funciona nesta tela |
| **Ativar este leitor** (1ª vez): código (digitado ou lido por QR), nome do aparelho, **PIN do operador** | (configuração inicial) | |
| **Teclado:** nº identificador + senha + teclado numérico, volta sozinho em 30 s | Teclado | Senha mascarada |
| **Leitura de código:** câmera + digitar o código | QR Code | Avisa se a câmera só lê QR |
| **Resultado** (tela cheia, cor + ícone + texto) | — | Nunca só cor; "Entrada"/"Saída" quando o ponto tem sentido |
| **Configurações** (protegidas por **PIN do operador** local; 5 erros = 5 min) → menu | Menu "Bem-vindo às configurações" | O operador **não** entra com e-mail/senha da nuvem: o PIN é local (PBKDF2-SHA256, sal por aparelho). Proteção de uso casual; aparelho perdido = revogar no painel |
| **Configurações do Sistema:** endereço do Edge, conexão (WebSocket/HTTPS/TCP desabilitado), câmera, log técnico (sem segredos), Salvar, **Testar conexão**, alterar PIN, desativar | Configurações do Sistema | Sem "banco/equipamento": o ponto vem da ativação |
| **Informações do Sistema:** versão, leitor, modo, conexão, Edge/nuvem, última comunicação, desvio de relógio, SO/navegador, tempo de atividade | Informações do Sistema | Sem pessoas/fotos; sem pesquisa de bem-estar |
| **Registros:** últimas 100 leituras **deste aparelho** (data/hora, forma, resultado, "Sinc.") | Registros | **Sem nome e sem identificador** (minimização, LGPD); "Sinc." = o Edge respondeu |
| Cadastro de faces / Licença facial | idem | **Não existem** (§9) |

Sem resposta do Edge a tela diz "Sem conexão com o Edge" e **nada é registrado nem enfileirado no aparelho** (senha/credencial nunca ficam guardadas no tablet; quem decide é o Edge). A decisão de não ter fila offline no leitor é de segurança (a 1ª versão previa uma).

## 8. Instalação e operação

1. Edge com leitores: `EDGE_READER_BIND` (liga), `EDGE_READER_PORT` (8443), `EDGE_READER_TCP_PORT` (opcional), `EDGE_READER_TLS_CERT`/`EDGE_READER_TLS_KEY` (juntas), `EDGE_READER_WEB_DIR` (pasta `apps/reader/dist`). **Produção fora de loopback exige TLS** (a senha trafega no corpo da mensagem, assinada mas não cifrada sem TLS); `config.js` recusa a subida sem ele.
2. `pnpm --filter @zela/reader build` e apontar `EDGE_READER_WEB_DIR` para `apps/reader/dist`.
3. Painel: Pontos de acesso → modo "Somente registro" (se for só registrar) → Leitores Zela Pass → Novo → anotar o código.
4. Tablet: abrir `https://<edge>:8443`, informar o código e o PIN do operador, "Instalar" o app. O Edge precisa já ter sincronizado o snapshot (senão `NO_SNAPSHOT`).
5. Certificado: o navegador precisa **confiar** no certificado do Edge (CA interna instalada no tablet ou certificado de domínio real); autoassinado não instalado impede PWA/câmera. Procedimento por cliente: PENDENTE.
6. Modo quiosque (tela fixa, sem sair do app): depende do Android/MDM; o app só pede tela acesa e fullscreen e **não** consegue garantir o bloqueio.

## 9. Facial

**Fora.** Só depois do benchmark (D-007) e do RIPD (D-019). Biometria desligada por padrão; via `BiometricProvider`; liveness só se comprovadamente suportado; alternativa sem biometria sempre. Por isso o PWA não tem botão "Facial", "Cadastro de faces" nem "Licença facial". Biometria no navegador do tablet (câmera, gabarito no cliente) tem risco próprio: decidir em fase própria.

## 10. Evidência de teste (executado em 08/10/2026, máquina de desenvolvimento)

| Item | Resultado |
|---|---|
| Domínio (Vitest): protocolo, envelope, validações, evidência | 296/296 (46 novos) |
| Edge (Vitest): serviço, ativação, replay, relógio, revogação, limites, idempotência, atuação/sem driver, HTTPS/WS/TCP reais em loopback, config, relato à nuvem | 231/231 |
| PWA (Vitest): WebCrypto × serviço real do Edge, relógio, resposta perdida, transporte, PIN do operador | 12/12 |
| pgTAP (RLS, cross-tenant, hash oculto, snapshot, ativação, revogação, auditoria) | 1104/1104 (35 novos em `31_`) |
| `rbac:drift` | 228 permissões idênticas |
| E2E com banco (`apps/edge-agent/e2e/zela-pass.e2e.mjs`): leitor → Edge **sem driver de porta** → gateway → `access_events`; 3 transportes; sem `physical_outcome`/comando; sem segredo na evidência; revogação; replay; mais o **daemon real** (`main.js`) servindo o PWA, ativando, registrando e entregando à nuvem | 19/19 PASS |
| E2E de navegador (`apps/reader/e2e/reader.browser.mjs`, Chromium 153): ativação, quiosque, senha, leitor-teclado, câmera falsa, configurações, revogação, Edge fora, CSP | 18/18 PASS |
| Painel (Playwright `e2e/readers.spec.js` + `physical.spec.js`): modo do ponto, criar leitor, código único, revogar, papéis, isolamento | readers 3/3 e physical 1/1 PASS (sem sobras no banco) |
| Regressão: E2Es do Edge (cloud-slice, device-alarm, device-command, device-key, biometric-erasure) | PASS |

**NÃO TESTADO:** tablet/celular real; câmera real lendo QR/barras (só câmera falsa do Chromium); `BarcodeDetector` e jsQR com imagem real; Safari/Firefox; PWA instalado e service worker em HTTPS real; TLS/WSS/TCP+TLS com certificado real; modo quiosque; carga; bateria/tela acesa (`wakeLock`); vários leitores simultâneos no mesmo Edge.

## 11. Limites conhecidos e pendências

- **Revogação** vale em até 5 min (próximo snapshot). **Decisão (08/10/2026, delegada ao Claude): manter 5 min no MVP**; tablet roubado não ativa porta (o Zela Pass não tem atuação) e só registra presença, então o risco é fraude de registro, não de acesso físico. Revogação por empurrão / intervalo menor só para leitores fica no backlog (não obrigatório).
- **Edge sem o armazenamento** (disco novo/apagado) perde as chaves dos leitores: é preciso revogar e ativar de novo (leitor "ativo" na nuvem sem chave local responde `UNAUTHORIZED`).
- **Código de ativação** expirado deixa o leitor "Aguardando ativação" até alguém revogá-lo.
- **Chave do aparelho** fica no IndexedDB (não extraível por script, mas apagável); o app pede `persist()`. Limpar dados do navegador desativa o leitor.
- **iOS:** Ed25519 no WebCrypto exige Safari 17+; sem `BarcodeDetector` (só QR por jsQR). Não testado.
- **Nome "Zela Pass":** conferir disponibilidade no INPI (antes se cogitou "Zela iD", descartado por lembrar Control iD).
- **TCP/IP:** servidor pronto e testado; cliente nativo é projeto futuro (reusar `reader-test-client.js` como referência do protocolo).
- Fronteira ponto × acesso e finalidade no RIPD seguem com parecer jurídico (`24-`).
- Ameaças e riscos residuais do leitor: `14-THREAT-MODEL.md` §Zela Pass.
