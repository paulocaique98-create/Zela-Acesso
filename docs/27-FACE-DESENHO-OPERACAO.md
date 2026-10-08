# 27 — Facial (Zela Pass): desenho, instalação e operação

**Estado:** IMPLEMENTADO e TESTADO em ambiente local (ver §8). **Não** testado em tablet/celular físico, câmera real, TLS real, Safari/Firefox, nem contra ataque de apresentação. Biometria continua **desligada por padrão**. Decisão: D-028. Benchmark: `26-FACE-BENCHMARK.md`.

## 1. Como funciona (uma página)

```
 PAINEL (nuvem)                          TABLET (Zela Pass, navegador)                 EDGE (local)
 1. Política biométrica completa  ──┐
 2. "Cadastrar biometria": aviso,   │
    alternativa, maior de 18 anos   │
    -> RPC enroll_biometric_profile │
       (provider sface-edge,        │
        ref face:<uuid>)  ──────────┼─ snapshot ─────────────────────────────────────> perfil ativo (sem gabarito ainda)
    mostra CÓDIGO DE CAPTURA (8 hex)│
                                    │   3. Operador: Configurações > Cadastro facial
                                    │      digita o código; a pessoa olha a câmera
                                    │      Human: rosto, malha, antispoof/liveness
                                    │      alinha 5 pontos -> SFace -> vetor 128 floats
                                    │      5 quadros -> média + consistência
                                    │      envelope assinado (Ed25519) ───────────────> face_enroll: valida código, política,
                                    │                                                   liveness, rosto duplicado; grava o vetor
                                    │                                                   CIFRADO (AES-256-GCM, EDGE_STORE_KEY)
                                    │   4. Quiosque: botão "Facial" (só se o Edge
                                    │      informar `face:true`) -> mesma captura
                                    │      envelope assinado (attempt, method face) ──> identifica 1:N, verifica 1:1, aplica
                                    │                                                   política/limiar/retenção e DECIDE com o
                                    │                                                   evaluateAccess (determinístico)
                                    │   <──────── "Registrado" / "Credencial inválida" ─
 evidência na fila -> nuvem (sem vetor, sem imagem, sem código de captura)
```

- **Imagem:** vive só no `<video>`/canvas do tablet durante a captura; nunca é gravada nem enviada. O E2E confere que IndexedDB/localStorage do aparelho e a fila de eventos do Edge não contêm vetor, imagem nem código.
- **Quem decide:** o Edge, pelo motor determinístico. O tablet só captura e informa vetor + resultado da prova de vida. IA generativa não participa de nenhuma decisão.
- **Fail-closed:** política desligada/incompleta/RIPD vencido, perfil inativo ou fora da retenção, gabarito ausente, amostra inválida, liveness reprovada (quando exigida), rosto ambíguo ou desconhecido => recusa com evidência. Saída segura nunca depende do facial.

## 2. Componentes

| Peça | Onde | Função |
|---|---|---|
| Vetor, comparação, escala de pontuação | `packages/biometrics/src/face.js` | float32 128 dims, cosseno, `similarityToScore` (cosseno 0,363, limiar oficial do SFace → 0,80; ≥ 0,75 → 1,00) |
| Alinhamento 5 pontos | `packages/biometrics/src/face-align.js` | referência ArcFace 112×112, transformação de similaridade |
| Motor no navegador | `apps/reader/src/lib/face/engine.js` | Human (detector, malha, antispoof, liveness) + SFace (onnxruntime-web, WASM, 1 thread) |
| Captura e resumo | `apps/reader/src/lib/face/{capture,summarize}.js` | 5 quadros válidos, consistência par a par ≥ 0,6, liveness pela mediana (real ≥ 0,5 e live ≥ 0,5) |
| Telas | `apps/reader/src/screens/Face.jsx` | `FaceScan` (identificar) e `FaceEnroll` (cadastro, atrás do PIN do operador) |
| Protocolo | `packages/domain/src/reader.js` | método `face` (`d` 684 chars, `lv`), mensagem `face_enroll` (`code`, `d`, `lv`), `status.face` |
| Provedor | `apps/edge-agent/src/face-provider.js` | `sface-edge`: `verify`, `identify` 1:N com margem 0,05, `enroll` (nunca sobrescreve), `duplicateOf`, `erase` |
| Gabaritos | `apps/edge-agent/src/store.js` | tabela `face_templates`, vetor cifrado em repouso; `EDGE_STORE_KEY` obrigatória em produção |
| Serviço | `apps/edge-agent/src/reader-service.js` | autentica o leitor, identifica, chama `verifyBiometricAttempt` e `processAccessAttempt` |
| Painel | `apps/web/src/pages/BiometricPages.jsx` | cadastro guiado com consentimento; mostra o código de captura |

## 3. Instalação

1. `pnpm install`.
2. `node scripts/fetch-face-models.mjs` (ou `pnpm face:models`): copia os modelos do Human (npm) e o WASM do ONNX Runtime para `apps/reader/public/{models,ort}` e baixa o **SFace** (38 MB) do OpenCV Zoo conferindo o SHA-256 fixado (`0ba9fbfa…4e79`). Sem rede: colocar o arquivo em `.cache/face-models/sface.onnx`. Nada disso vai para o git.
3. `pnpm --filter @zela/reader build` e servir `apps/reader/dist` pelo Edge (`EDGE_READER_WEB_DIR`). O Edge já serve `.wasm`/`.mjs`/`.onnx`, a CSP permite `'wasm-unsafe-eval'` e os modelos têm cache de 1 dia.
4. No Edge: `EDGE_FACE=1` (liga a identificação por rosto; **desligado por padrão**) e `EDGE_STORE_KEY` (64 hex; já é obrigatória em produção, então o gabarito nunca fica em claro lá). A fila de eliminação LGPD roda sempre, com ou sem `EDGE_FACE`.
5. Tablet: HTTPS com certificado confiável (câmera exige contexto seguro; ver `25-ZELA-PASS-DESENHO.md` §8). O primeiro uso baixa ~50 MB e o service worker guarda para uso sem rede.

## 4. Operação

1. **Painel > Biometria > Configurar política** (ver §6): sem política completa e RIPD vigente, nada funciona e o botão "Facial" nem aparece no tablet.
2. **Cadastrar biometria** (somente adultos, não visitantes): aviso entregue, alternativa não biométrica oferecida, maior de 18 anos. O painel mostra o **código de captura** (8 caracteres); ele também aparece na linha do perfil ativo.
3. **Tablet > Configurações (PIN do operador) > Cadastro facial**: digita o código e a pessoa olha para a câmera (de frente, boa luz, sozinha na imagem). Sucesso: "Rosto cadastrado". O código só funciona uma vez (não sobrescreve); outro rosto já cadastrado é recusado (`FACE_ALREADY_ENROLLED`).
4. **Uso:** botão **Facial** no quiosque. Resultado "Registrado" ou "Credencial inválida" (o motivo detalhado fica só na evidência).
5. **Revogar** no painel: a credencial é revogada na hora; o Edge apaga o gabarito local no próximo sync (fila de eliminação) e confirma à nuvem. **Retenção:** perfil vencido deixa de reconhecer e entra na mesma fila.

## 5. Ameaças e limites (honestos)

| Item | Situação |
|---|---|
| Foto/tela/vídeo/máscara diante da câmera | Mitigação **parcial e não validada**: liveness passiva do Human (modelos antispoof/liveness em quadros do vídeo). Sem teste de ataque de apresentação (ISO/IEC 30107-3). Para áreas de risco alto: ligar o **segundo fator do ponto** (PIN depois do facial, D-031, abaixo). |
| Leitor comprometido envia vetor/liveness falsos | O vetor e a liveness são calculados no tablet e o Edge confia no aparelho autenticado (assinatura Ed25519 + revogação). Recalcular no Edge exigiria runtime de ML no servidor (não feito). Decidido não recalcular no Edge (D-030): mitigar com segundo fator por ponto (D-031, implementado), MDM/quiosque e revogação rápida. |
| Gêmeos, irmãos, pessoas muito parecidas | Margem 1:N de 0,05 recusa o ambíguo; não elimina o risco. |
| Viés demográfico do modelo | **Não avaliado** (benchmark sem recorte demográfico). Obrigatório medir com a população da Alfa, com consentimento, antes de operação. |
| Gabarito roubado do disco do Edge | Cifrado com AES-256-GCM; a chave está no ambiente do Edge. Quem tem a máquina e a chave tem o gabarito: proteger o host. |
| Só um Edge guarda o gabarito | O gabarito vive no Edge onde foi capturado. Outro Edge/site não reconhece a pessoa até capturar lá (cadastro por Edge). Decidido: replicação Edge a Edge cifrada (D-029), implementação pendente. |
| Painel não sabe se a captura já foi feita | **Resolvido:** após cada sync o Edge relata à nuvem (`face_captured` → `edge_report_face_captured`) os perfis com gabarito local; só o id do perfil vai (nunca vetor/referência). O painel mostra "Rosto capturado em …" ou "Aguardando captura" (`biometric_profiles.captured_at`, auditado). Testado: pgTAP 32 (9), gateway e `face-report.test.js`. Não testado ponta a ponta com Edge+nuvem reais. |
| Latência | ~1–2 s por quadro em software (PC sem GPU); 5 quadros ≈ 6–10 s. Em tablet real: NÃO medida. |

## 6. Política biométrica da Alfa (o que só o cliente pode preencher)

O sistema bloqueia o facial até que **todos** os itens existam e o RIPD esteja dentro de 12 meses. Não foram preenchidos por mim: são decisões jurídicas da Alfa.

| Campo (Painel > Biometria > Configurar política) | Quem define | Observação |
|---|---|---|
| Base legal (consentimento / prevenção à fraude e segurança do titular / obrigação legal) | Alfa + jurídico | Legítimo interesse não vale para dado sensível. Se consentimento: cada pessoa registra o seu. |
| Retenção (1–1095 dias) | Alfa | Gabarito apagado ao fim e na revogação. |
| Versão do aviso de privacidade | Alfa | O aviso (finalidade, retenção, direitos, alternativa) precisa existir e ser entregue. |
| Contato do encarregado (DPO) | Alfa | Obrigatório. |
| Versão do RIPD, revisado em, próxima revisão (≤ 1 ano) | Alfa/DPO | O RIPD em si (relatório de impacto) é documento da Alfa. |
| Limiar (0,80–1,00; padrão 0,90) e liveness exigida (padrão sim) | Alfa com a Arx | Sugestão inicial **0,85** para quiosque cooperativo; ver FRR em `26-`. Não baixar de 0,80 (bloqueado). |

Regulatório: o facial para controle de acesso continua dependendo de validação jurídica (Guia ANPD de Biometria e Lei 14.967 seguem abertos em `07-REGULATORY-MATRIX.md`). Nada aqui afirma conformidade.

## 7. Variáveis e scripts

`EDGE_FACE=1`, `EDGE_STORE_KEY`, `EDGE_READER_*` (existentes). Scripts: `pnpm face:models`, `pnpm face:bench <fotos> <rotulos.json>`, `pnpm e2e:face` (precisa de `FACE_E2E_DIR` com `ana1.jpg`, `ana2.jpg`, `bob.jpg`; fotos fora do repositório).

## 8. Evidência de teste (08/10/2026, máquina de desenvolvimento, Chromium com WebGL por software)

| Item | Resultado |
|---|---|
| Vitest: domínio 304, biometria 32 (inclui `face.test.js`), edge 259, leitor 17, web 26 | PASS |
| Provedor facial do Edge (`face-provider.test.js`, 10): verify, identify 1:N, ambiguidade, duplicado, erase, cifra em repouso | PASS |
| Serviço do leitor (`reader-face.test.js`, 17): status, captura única, liveness, rosto duplicado, assinatura inválida, tentativa, retenção, limiar, snapshot sem perfil, reenvio, sem vetor na fila, eliminação LGPD | PASS |
| E2E de navegador `face.browser.mjs` (Chromium + dist + Edge real + modelos reais): 10/10 — ativa, recusa sem gabarito, câmera negada, cadastro pelo código, código não reutilizável, reconhece a mesma pessoa em outra foto, recusa outra pessoa, evidência sem vetor, armazenamento do aparelho sem vetor, sem erro de console/CSP | PASS |
| Painel + banco (Playwright `biometrics.spec.js`): política, cadastro com código de captura, revogação, isolamento | PASS (1/1) |
| Regressão: `reader.browser.mjs` 18/18, `zela-pass.e2e.mjs`, `biometric-erasure.e2e.mjs`, `rbac:drift` 228, varredura de segredos no bundle | PASS |
| Benchmark (SFace, LFW 150 pares): AUC 0,9985, EER ≈ 1,7 % | ver `26-FACE-BENCHMARK.md` |
| Câmera real, tablet real, Safari/Firefox, TLS real, ataque de apresentação, viés demográfico, carga | **NÃO TESTADO** |

## Segundo fator por ponto (D-031)

- **Configuração:** painel > Pontos de acesso > "Segundo fator (facial)": `Nenhum` (padrão) ou `Facial + senha (PIN)`. Mudança auditada (`access_points.second_factor`, só old/new) e levada ao Edge no snapshot (`secondFactor`). Snapshot antigo sem o campo = `none`.
- **Fluxo:** facial reconhecido → o motor devolve `CHALLENGE` (`MULTI_FACTOR_REQUIRED`, passo `second_factor:required`) → o Edge responde `CHALLENGE_REQUIRED` com `challengeId` → o leitor mostra "Confirme com sua senha" (só PIN) → reenvia `{method:'pin', challengeId, pin}` assinado → o Edge confere o PIN **da pessoa do desafio** → `challenge:satisfied` e `ALLOW` (ou `DENY`/`CREDENTIAL_INVALID` com `challenge:failed`).
- **Desafio:** 128 bits aleatórios, uso único (consumido mesmo se o PIN errar: refaz o facial), 60 s, preso ao leitor e ao ponto, só em memória do Edge (reiniciar o Edge exige refazer o facial), teto de 1000 abertos. Repetir o facial para tentar o PIN várias vezes esbarra no bloqueio do PIN (5 erros → 5 min por pessoa).
- **Limites conhecidos:** vale **só para facial**; PIN, cartão e QR sozinhos seguem como antes. O bloqueio por tentativas é por pessoa: quem tem o rosto de outra pessoa (ou uma foto que passe) pode bloquear o PIN dela por 5 min (negação de serviço, não acesso). Offline: sem a confirmação nunca abre, nem em `degraded_allow`. O PIN trafega no corpo assinado do leitor para o Edge (TLS obrigatório fora de dev) e nunca vai a log, evento ou evidência (teste confere).
- **Estado:** IMPLEMENTADO e TESTADO local (Vitest + pgTAP 33); **NÃO testado** com tablet/câmera reais nem ponta a ponta no navegador (E2E `face.browser.mjs` não cobre o segundo fator).

## Endereço do Zela Pass por nome (piloto gratuito com DuckDNS)

- **Decisão do dono (08/10/2026):** piloto sem custo, com subdomínio gratuito do DuckDNS; domínio próprio (~R$ 40/ano, DNS Cloudflare e certificado Let's Encrypt gratuitos) fica para quando houver vários clientes. **Limites do DuckDNS e do Let's Encrypt: a confirmar na fonte oficial antes do primeiro cliente real** (o número de subdomínios gratuitos por conta limita o piloto a poucos locais).
- **IMPLEMENTADO e TESTADO (Vitest):** em Locais, o campo "Endereço do Zela Pass" é sugerido a partir do nome da organização e do local: `https://<organizacao>-<local>.duckdns.org` (`suggestZelaPassUrl`, `packages/domain/src/zela-pass-address.js`; sem acento, sem sufixo societário, rótulo ≤ 63 caracteres). Editável; um endereço já gravado nunca é sobrescrito. O banco só aceita `https://host[:porta]`, sem caminho.
- **NÃO implementado (manual no piloto):** (1) criar a conta e o subdomínio no DuckDNS com o nome sugerido; (2) apontar o subdomínio para o IP do Edge na rede local (o Edge precisa de IP fixo/reservado no roteador); (3) emitir o certificado Let's Encrypt por DNS-01 (o DuckDNS permite gravar o registro TXT por API) e instalá-lo no Edge. O token do DuckDNS é segredo do Edge: nunca em log, evento ou evidência.
- **Risco conhecido:** roteadores com proteção contra DNS rebinding bloqueiam nomes públicos que resolvem para IP privado; exige exceção no roteador. O DNS público passa a expor o nome do local e o IP interno.
- **Próximo (se aprovado):** o Edge atualizar sozinho o IP no DuckDNS e renovar o certificado; só depois disso o link "Copiar link" funciona sem passo manual.

## Provisionamento automático do endereço do Zela Pass (DESENHO, não implementado)

- **Objetivo (decisão do dono, 08/10/2026):** o cliente não faz nada técnico. Sem conta de DNS, token, reserva de IP ou certificado manual; só o código de ativação do Edge, que já existe. DuckDNS fica só como piloto isolado (não escala: um subdomínio por conta, limite pequeno).
- **Domínio-base configurável** (hoje constante `ZELA_PASS_BASE_DOMAIN`, `duckdns.org`; passará a configuração da plataforma). O desenho não depende de qual domínio: **eu.org** (gratuito, pedido pelo dono, aprovação sem prazo conhecido) ou domínio próprio da Arx (plano B, ~R$ 40/ano, a confirmar). Zona servida por DNS com API (Cloudflare, plano gratuito).
- **Nome:** um rótulo por local, `<organizacao>-<local>.<base>` (`suggestZelaPassUrl`), calculado **no servidor** a partir do cadastro; o Edge nunca escolhe o nome.
- **Registro do IP:** Edge → função `edge-dns-register` (autenticada pelas credenciais do agente, como o gateway): envia o IP da LAN; a função aceita só IP **privado** (RFC 1918), só para o nome do site daquele agente, com limite de taxa, e grava o registro A. Sem token de DNS no Edge (o token da Cloudflare é segredo da função). Reenvio periódico acompanha mudança de IP (dispensa IP reservado). Revogar o agente remove o registro.
- **Certificado:** o Edge gera a chave e o CSR **localmente (a chave nunca sai do Edge)** e conduz o ACME (Let's Encrypt, DNS-01); para o TXT `_acme-challenge.<nome>`, chama a função `edge-acme-challenge` (mesmas regras: só o nome do próprio site; o valor é validado), que grava e depois apaga o TXT. Renovação automática com 30 dias de sobra; falha de renovação gera alerta no painel.
- **Contingência sem internet:** o Edge continua servindo com o certificado em disco enquanto válido; sem DNS público o tablet só resolve o nome com internet (ou DNS local): documentar.
- **Riscos:** roteadores com proteção contra DNS rebinding bloqueiam nome público → IP privado (exige exceção); o DNS público expõe nome do local e IP interno; limites do Let's Encrypt por domínio registrado (conferir na fonte antes de escalar); **política do eu.org**: sites comerciais são aceitos "como último recurso" e o serviço é voltado a organizações sem fins lucrativos — risco de revogação para um SaaS comercial; por isso o domínio próprio é o plano B obrigatório antes do primeiro cliente pagante.
- **Testes previstos:** funções com clientes simulados (nome só do próprio site, IP público recusado, limite de taxa, agente revogado); ACME contra o ambiente de teste (staging) do Let's Encrypt; **validação real só com domínio e tablet**.
