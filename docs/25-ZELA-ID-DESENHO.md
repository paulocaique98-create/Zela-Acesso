# 25 — Desenho: Zela iD (leitor em tablet/celular)

Data: 08/10/2026. Status: **DESENHO, nada implementado nem testado**. Origem: `24-PONTO-VIRTUAL-PESQUISA.md` e decisões do dono de 08/10/2026 (controle de acesso, não ponto; identificar para REGISTRAR; nome "Zela iD"; app web; telas parecidas com as de referência, com a marca Zela). Substitui o nome provisório "Zela Check-in".

## 1. O que é

Um novo tipo de leitor (`tablet`) que roda como **app web instalável (PWA)** num tablet ou celular de portaria. Identifica a pessoa por **senha numérica, QR Code ou código de barras** (facial só depois, §8) e **registra entrada/saída**. Não decide nada: envia a credencial ao Edge, que avalia com o `evaluateAccess` de sempre. Atuação (abrir porta) é opcional e do ponto, não do leitor.

## 2. Telas (equivalentes funcionais às de referência, identidade visual Zela)

Mantemos o **fluxo e a organização** das 6 telas de referência; trocamos marca, paleta (Zela, não amarelo/cinza da referência), ícones, textos e componentes (desenhados do zero). Sem copiar assets, logotipos nem textos.

| # | Tela (Zela iD) | Equivalente na referência | Diferenças deliberadas |
|---|---|---|---|
| 1 | **Início do leitor**: logo Zela iD, relógio grande e data, indicadores (modo do ponto, nuvem/Edge, rede), 3 botões: QR Code, Facial (oculto/desabilitado enquanto biometria estiver desligada), Teclado; engrenagem para o operador | Tela de boas-vindas com relógio | Hora vem do Edge (relógio confiável, não do aparelho); mostra aviso se o relógio do aparelho divergir. Faixa de logotipo do cliente (branding por tenant, já existe `useBranding`) |
| 2 | **Login do operador / menu de configuração**: org, ponto vinculado, 4 itens: Configurações, Informações do Sistema, Registros, (Cadastro/Biometria só se o módulo estiver ligado) e Sair | Menu "Bem-vindo às configurações" | Exige login do operador (Supabase Auth, MFA se a org exigir) com permissão nova `reader:configure`; sai sozinho após inatividade |
| 3 | **Configurações do Sistema**: organização, local, ponto de acesso, modo (`register_only` ou com atuação), botão Salvar e **Testar conexão**, opção de log técnico (sem PIN/token, regra do CLAUDE.md) | Configurações do Sistema | Sem "banco/equipamento" soltos: o ponto vem da lista do tenant filtrada por RLS |
| 4 | **Informações do Sistema**: versão do app, nº de eventos locais, pendentes de envio, tamanho do cache, SO/modelo, tempo de atividade, última sincronização, desvio de relógio | Informações do Sistema | Sem pesquisa de bem-estar (fora de escopo). Sem contagem de "pessoas/fotos" por padrão |
| 5 | **Registros** (últimos eventos do próprio aparelho): identificador **mascarado**, resultado, data/hora, indicador de sincronizado | Registros com Número/Nome/Data/Sinc. | **Não mostra nome nem lista de pessoas** (minimização, LGPD; tela de portaria não expõe quem é quem). Visível só ao operador autenticado |
| 6 | **Cadastro de faces** | Cadastro de Faces / Licença Facial | **Fora até §8**; sem biometria nenhuma tela de captura existe |

Feedback no leitor (tela 1): resposta de cada leitura em até 1–2 s, cor + ícone + texto ("Registrado", "Não autorizado", "Credencial inválida", "Sem conexão com o Edge"), nunca só cor. Mensagem curta, sem expor motivo sensível (o motivo detalhado fica na evidência).

## 3. Conexão (diferente da referência)

A referência registra o app como "controlador TCP/IP" num servidor de acesso. **Um navegador não abre socket TCP bruto**, então o PWA não pode copiar isso literalmente. Desenho proposto (HIPÓTESE, validar com protótipo):

- **Caminho principal, LAN**: o PWA fala com o **Edge Agent da própria instalação** por HTTPS e WebSocket (TCP por baixo, mas protocolo próprio do Zela; mensagens JSON versionadas). O Edge **serve o próprio PWA** e usa certificado local; isso evita *mixed content* (página https da nuvem chamando http da LAN, bloqueado pelo navegador) e mantém o leitor funcionando com a internet fora.
- **Caminho de contingência**: sem Edge na LAN, o PWA usa o `edge-gateway` da nuvem (mesma assinatura de dispositivo), com `degraded_deny` por padrão.
- **Nada decide no tablet.** O aparelho envia a leitura e mostra a resposta do Edge.
- Fila local do leitor (IndexedDB, **cifrada com chave não extraível do WebCrypto**) só guarda leituras já assinadas enquanto o Edge não responde, com teto e expiração curta; ao reconectar reenvia com `device_event_id` (idempotência, D-006). Offline do **leitor** não vira ALLOW: quem decide é o Edge/nuvem.

## 4. Identidade do dispositivo (enrollment e chave)

Igual ao agente (D-022): par **Ed25519 gerado no aparelho** via WebCrypto (`extractable:false`, guardado no IndexedDB), pública registrada no enrollment, **cada requisição assinada** (leitor + instante ±120 s + SHA-256 do corpo). Enrollment por token de uso único emitido pelo painel para um operador com `reader:enroll`, vinculado a tenant + ponto; revogação no painel derruba o leitor na hora. Limite honesto: a privada fica protegida pelo navegador/SO, não por hardware atestado; tablet roubado = revogar. Modo quiosque (tela fixa, sem sair do app) depende do Android/MDM; o app avisa que não consegue garantir.

## 5. Ponto `register_only` e evento de marcação (domínio)

- `access_points`: novo campo `actuation` = `none | driver` (ou tipo `virtual` com `actuation:none`); `register_only` = `none`, **sem `physical_outcome`, sem driver, sem comando**. Direção `entry/exit/bidirectional` já existe. Reuso: presença, anti-passback, evidência append-only.
- `evaluateAccess` continua único. Para `register_only`, ALLOW significa "marcação aceita". Novo evento de evidência `presence.registered` (e `presence.rejected` com o código de motivo estável), com `reader_id`, `credential_kind`, `method` (`pin|qr|barcode`), `direction`, hora do Edge, hash encadeado. Correção = novo evento, nunca edição.
- Códigos de motivo novos só quando faltar um existente; revisar `access-contracts.js` antes de criar.
- Sem jornada: nenhuma tela, exportação ou texto fala em ponto, horas, atraso ou folha (decisão do dono).

## 6. Mapeamento de credenciais (sem criar tipo novo)

| Leitura | Credencial existente | Regras |
|---|---|---|
| Senha numérica (nº identificador + PIN) | PIN (hash, nunca texto puro) | Limite de tentativas e bloqueio temporário no Edge; o PIN trafega só sobre o canal assinado e nunca é logado. Verificar se "nº identificador" é público ou segredo antes de aceitar só ele |
| QR Code | `mobile_token` | Token de alta entropia, expiração curta e rotativo; revogável. QR estático impresso = risco de cópia (aceitável só se a política permitir) |
| Código de barras (Code 39, 2 de 5 Intercalado, PDF 417 como na referência) | cartão/credencial por código | Mapeia para credencial já cadastrada (hash); definir simbologias suportadas só após testar leitura pela câmera |

Várias credenciais por pessoa continuam valendo. Credencial desconhecida gera evento `presence.rejected` sem revelar se a pessoa existe.

## 7. Segurança (resumo; detalhar no threat model antes de implementar)

Tela de portaria sem lista de pessoas; login do operador com MFA conforme a org; sessão do operador separada da identidade do leitor; CSP restritiva e sem `service_role` no bundle; leitor revogável; limite de taxa por leitor; hora do Edge; logs sem PIN/token/biometria; câmera só para ler QR/barras (sem gravar imagem). Ataques a cobrir: foto de QR, força bruta de PIN, tablet roubado, relógio adulterado, leitor falso (sem chave), replay (instante + idempotência).

## 8. Facial

Só depois do benchmark (D-007) e do RIPD (D-019). Biometria desligada por padrão; via `BiometricProvider`; liveness só se comprovadamente suportado; alternativa sem biometria sempre. A tela de cadastro de faces e o botão "Facial" ficam inexistentes/ocultos até lá. Biometria no navegador do tablet tem mais risco (câmera, extração de gabarito no cliente): decidir em fase própria.

## 9. Plano de entrega (fatias, cada uma com teste)

1. **Domínio**: `AccessReader` (tipo tablet, estado, vínculo ao ponto), `register_only`, evento `presence.registered/rejected` + testes Vitest.
2. **Banco**: tabela de leitores + enrollment + chave pública + permissões `reader:*` + RLS + pgTAP cross-tenant (exige Docker/Supabase local).
3. **Edge**: endpoint de leitura (HTTPS/WS) com verificação de assinatura, mapeamento PIN/QR/barras, evidência sem driver; **E2E sem driver de porta**.
4. **PWA**: telas 1–5, instalável, fila offline, Playwright.
5. **Facial**: depois do benchmark e do RIPD.

## 10. Decisões e pendências do dono

1. **Nome "Zela iD"**: "iD" também compõe a marca **Control iD**, nosso 1º driver de hardware (D-023). Risco de confusão/marca; **checar disponibilidade no INPI e parecer jurídico** antes de usar publicamente. O código usa o identificador neutro `reader`.
2. Aceitar a conexão HTTPS/WebSocket (e não TCP bruto) pelo limite do navegador? (recomendado)
3. PWA basta, ou há necessidade de app Android nativo (kiosk, câmera, offline robusto)? Decidir com protótipo da fatia 4.
4. Tela "Registros" sem nome: confirmar com o piloto.
5. Fronteira ponto x acesso e finalidade no RIPD continuam com parecer jurídico (`24-`).
