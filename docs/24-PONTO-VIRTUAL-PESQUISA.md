# 24 — Pesquisa: coletor virtual de ponto e acesso (referência: Secullum Checkin / Ponto Virtual)

Data: 08/10/2026 (revisada no mesmo dia: a 1ª versão olhou o produto errado, o app "Ponto Web – Funcionários"). Status: **PESQUISA, nada implementado**. O limite permanente do projeto diz "acesso físico ≠ ponto; sem REP/AFD, folha, vigilância/monitoramento profissional no MVP". A parte de **acesso** do Checkin cabe no Zela Acesso; a parte de **ponto (REP-P)** só começa depois do MVP e exige o dono alterar esse limite no `PROMPT_MESTRE_ZELA_ACESSO_CLAUDE_CODE.md` e em `19-DECISIONS.md`.

## O produto de referência (fonte: páginas oficiais da Secullum; planos e preços NÃO levantados)

São dois apps parentes, ambos um **coletor de uso coletivo** num tablet ou smartphone, no lugar de relógio de ponto tradicional:

| | Secullum Ponto Virtual | Secullum Checkin |
|---|---|---|
| Para quê | Marcação de ponto (REP-P), integrado ao Secullum Ponto Web | Marcação de ponto **e validação de acesso**; liga em Ponto Web ou nos sistemas de acesso da Secullum |
| Plataformas | Android | Android, iOS, Windows, Linux |
| Identificação | Senha numérica (número identificador), QR Code, código de barras (Code 39, 2 de 5 Intercalado, PDF 417), reconhecimento facial local | Os mesmos, mais reconhecimento facial online (BioWeb); facial sem toque só com o Ponto Web |
| Offline | Senha, QR e barras online e offline; facial offline com licença; sincroniza sozinho ao reconectar (a cada minuto, segundo o blog) | Igual; no iOS não há biometria offline, sincronização em segundo plano nem detecção de face; tablet precisa conectar a cada 7 dias para validar a licença do BioWeb |
| Extras | Geolocalização e foto da marcação na ficha de ponto, pesquisa de bem-estar (QVT), logotipo do cliente na tela inicial, ícones de status de conexão | Os mesmos |
| Acionamento | — | Aciona fechaduras, catracas, portas e cancelas por comando online do sistema de acesso (exemplo da página: catraca Control iD iDBlock); serve de leitor em cancela sem placa controladora |
| Requisitos | Android 6.0+, 2 GB de RAM (1 GB livre), câmera frontal 1 MP, quad-core 1,5 GHz, internet | Os mesmos |
| Licenças | Facial offline = Licença Facial | BioWeb (facial online, nuvem, 1 face por pessoa, sem limite de faces) e Biometria Facial Offline, vendidas à parte |

Como o Checkin integra ao acesso (FAQ oficial): cadastra-se o Checkin como controlador TCP/IP no sistema de acesso, informa-se no app o código do equipamento, o servidor e a porta, e um agente de serviço online mantém a conexão; o equipamento a acionar (catraca etc.) é escolhido no app e cada acesso validado dispara o comando de liberação.

Fontes: [Secullum Checkin – FAQ](https://www.secullum.com.br/pt/canal-cliente/perguntas/552), [Checkin com sistemas de acesso](https://www.secullum.com.br/pt/canal-cliente/perguntas/527), [Secullum Ponto Virtual – FAQ](https://www.secullum.com.br/pt/canal-cliente/perguntas/1161), [Blog: Secullum apresenta o Ponto Virtual](https://www.secullum.com.br/blog/a-secullum-apresenta-o-ponto-virtual-o-futuro-do-controle-de-frequencia/), [BioWeb](https://www.secullum.com.br/en/canal-cliente/perguntas/1158). A página `/pt/produtos/checkin` redireciona para uma lista de produtos descontinuados e não serviu. Planos e preços ficam com as revendas (não levantei).

## Leitura para o Zela Acesso

- **Já temos a base**: o Zela tem pessoas/credenciais, motor determinístico, evidência append-only, Edge offline com fila idempotente, comando assinado de abertura, módulo de biometria e driver de catraca/porta. Um "Zela Check-in" seria um **novo tipo de leitor** (app em tablet/celular) no modelo domínio → abstração → driver, não uma reescrita.
- **Parte acesso (cabe no MVP+)**: tablet como leitor de PIN/QR/código de barras/(facial por provider) numa portaria, enviando a credencial ao Edge, que decide e aciona o driver já existente. QR e código de barras já têm credencial no domínio (`mobile_token`, cartão). O desenho exige: autenticação do próprio tablet (chave de dispositivo, como o agente), nunca decidir no app, tela de portaria sem expor lista de pessoas, e nenhuma abertura local sem autenticação.
- **Parte ponto (REP-P)**: fora do MVP. Ver abaixo.
- **Facial**: reaproveita `BiometricProvider` e o módulo de consentimento/retenção; biometria desligada por padrão; `@vladmandic/human` segue candidato sujeito a benchmark; liveness só se realmente suportado. A Secullum guarda faces em nuvem (BioWeb): no Zela vale o contrário por padrão (template local/provider, só referência opaca na nuvem, D-019).
- **Modo kiosk em celular comum** tem riscos próprios: dispositivo roubado, tela de login do operador, atualização do app, relógio do aparelho (a Portaria exige hora legal; o Edge já trata deriva de relógio).

## Regulatório do ponto (REP-P, Portaria MTP 671/2021)

Fontes secundárias (fornecedores); **o texto oficial e o Anexo IX precisam ser lidos no gov.br/DOU antes de qualquer decisão**: REP-P é programa em servidor/nuvem com certificado de registro, identifica organização e trabalhador, sincroniza com a Hora Legal Brasileira (variação máx. 30 s), mostra relógio não analógico, aceita offline só em caráter excepcional, emite comprovante eletrônico de cada marcação, mantém dados invioláveis e gera AFD e AEJ; fornecedores citam ICP-Brasil nos comprovantes e registro no INPI (a confirmar). A Secullum se declara adequada à 671 como REP-P; **não verifiquei essa declaração**. Lacunas: procedimento oficial de certificação e leiaute atual do AFD/AEJ.

## O que NÃO fazemos

- Não copiamos código, textos, telas, marca ou identidade visual da Secullum, nem o nome "Checkin" como marca (usar nome próprio). Replicamos categorias de função, não a implementação.
- Não prometemos "conforme a Portaria 671" sem evidência: sem certificação/registro e parecer jurídico, qualquer marcação seria "ponto interno, sem valor de REP-P".

## Decisões para o dono

1. **Fatiar em dois produtos**: (A) **Zela Check-in de acesso** (leitor em tablet/celular para portaria, dentro do escopo de controle de acesso) e (B) **Zela Ponto** (marcação com valor legal, pós-MVP). Recomendação: fazer só o (A) primeiro; ele reaproveita quase tudo e não exige certificação.
2. Para o (B): ser REP-P certificado (INPI, AFD/AEJ, hora legal, comprovante) ou apenas coletar marcações para um sistema de ponto já regularizado.
3. **LGPD**: geolocalização e facial são dados pessoais (facial é biométrico/sensível); consentimento em relação de emprego é frágil; precisa de base legal, RIPD e parecer jurídico, e colide com o limite "sem vigilância/monitoramento profissional".
4. Plataforma do app (PWA no navegador do tablet, Android nativo ou ambos): PWA evita loja e distribuição, mas tem menos acesso a câmera/kiosk/offline robusto. Decidir com um protótipo.

## Próximos passos (quando o dono abrir a fase)

1. Dono: escolher (A) agora e (B) depois; confirmar se há cliente piloto com tablet na portaria.
2. Para (A): desenhar o leitor como novo `AccessReader` no domínio (tipo tablet), com enrollment e chave de dispositivo do tablet, mapeando QR/barras/PIN para as credenciais existentes; E2E contra o Edge com driver mock; facial só depois do benchmark.
3. Para (B): ler a Portaria 671 e o Anexo IX no gov.br, preencher `07-REGULATORY-MATRIX.md` e pedir parecer jurídico antes de requisitos.
