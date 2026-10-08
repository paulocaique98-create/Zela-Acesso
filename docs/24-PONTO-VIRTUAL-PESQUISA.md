# 24 — Pesquisa: ferramenta de ponto virtual (referência: Secullum)

Data: 08/10/2026. Status: **PESQUISA, nada implementado e fora do escopo do MVP**. O limite permanente do projeto diz "acesso físico ≠ ponto; sem REP/AFD, folha, vigilância/monitoramento profissional no MVP". Esta ferramenta só começa depois do MVP, e exige o dono alterar esse limite no `PROMPT_MESTRE_ZELA_ACESSO_CLAUDE_CODE.md` e em `docs/19-DECISIONS.md`.

## O que a pesquisa achou (fonte: loja de apps e material de divulgação, NÃO o manual técnico)

- Nenhuma página com o nome exato "Ponto Virtual" da Secullum. O aplicativo móvel dela é o **Ponto Web – Funcionários** ("Central do Funcionário"), que acompanha o **Secullum Ponto Web**. Se "Ponto Virtual" for outro produto ou nome de revenda, a pesquisa precisa ser refeita com o nome certo ou com um print das telas.
- Funções do app do funcionário (categorias, sem copiar texto): registro de ponto pelo celular (manual, geolocalização, foto, reconhecimento facial, conforme o plano), registro offline com envio posterior, consulta do cartão-ponto e de indicadores (extras, faltas, atrasos), pedido de ajuste e justificativa com anexo de atestado.
- Funções do gestor: ver o cartão-ponto da equipe e aceitar ou rejeitar solicitações e justificativas.
- Fontes: [Ponto Web – Funcionários (App Store)](https://apps.apple.com/BR/app/id1434571841), [Ficha Ponto4 (Secullum)](https://www.secullum.com.br/docs/portugues/Ficha_Ponto4.pdf), [Apresentação Ponto Secullum 4](https://www.secullum.com.br/docs/portugues/ApresentacaoPontoSecullum4.pdf).

## O que a lei exige de um registrador por aplicativo (Portaria MTP 671/2021, REP-P)

Fontes secundárias (fornecedores); **o texto oficial e o Anexo IX precisam ser lidos no gov.br/DOU antes de qualquer decisão** (regra do projeto: consultar fonte oficial atual e classificar lei/regulamento/norma/boa prática).
- REP-P é o programa de registro; roda em servidor dedicado ou na nuvem, com certificado de registro; segundo fornecedores, registro no INPI (a confirmar).
- Identificar organização e trabalhador; sincronismo com a Hora Legal Brasileira (variação máx. 30 s); relógio não analógico visível na marcação; marcação offline só em caráter excepcional, enviada ao voltar a rede.
- Comprovante eletrônico de cada marcação acessível ao trabalhador; dados invioláveis e auditáveis; geração do novo **AFD** e do **AEJ** (AFDT e ACJEF foram extintos); assinatura ICP-Brasil nos comprovantes é citada por fornecedores (a confirmar).
- Lacunas desta pesquisa: procedimento oficial de certificação/registro do REP-P e o leiaute técnico atual do AFD/AEJ.

## O que NÃO fazemos

- Não copiamos código, textos, telas, marca ou identidade visual da Secullum (direito autoral e concorrência). Usamos a mesma **categoria de funções**, com desenho e nome próprios, e o nome "Secullum" nunca aparece no produto.
- Não prometemos "conforme a Portaria 671" sem evidência: sem certificação/registro e parecer jurídico, a ferramenta seria "ponto interno, sem valor de REP-P".

## Riscos e decisões para o dono

1. **Escopo**: mudar o limite "acesso físico ≠ ponto" (MVP) e abrir fase própria no roadmap.
2. **Regulatório**: decidir entre ser REP-P (certificação, AFD/AEJ, ICP-Brasil, INPI) ou apenas coletar marcações para integrar a um sistema de ponto já regularizado (menos obrigações, menos valor).
3. **LGPD**: geolocalização e reconhecimento facial são dados pessoais (facial é biométrico/sensível); reaproveitaria o módulo de biometria (provider, consentimento, retenção, RIPD) e exigiria base legal própria, já que consentimento em relação de emprego é frágil. Também colide com o limite "sem vigilância/monitoramento profissional".
4. **Antifraude**: ponto por celular tem fraude clássica (GPS falso, foto de foto, "ponto de amigo"); liveness só se realmente suportado (regra do projeto).
5. **Reuso do que já existe**: multi-tenant/RLS, RBAC, evidência append-only com hash encadeado, fila offline idempotente do Edge, módulo de biometria, auditoria e retenção LGPD.

## Próximos passos sugeridos (quando o dono abrir a fase)

1. Dono: confirmar o produto e a versão da referência (print do app ou nome exato) e decidir o item 2 (REP-P ou coletor).
2. Ler no gov.br o texto consolidado da Portaria 671 e o Anexo IX e preencher `07-REGULATORY-MATRIX.md`.
3. Parecer jurídico sobre base legal de geolocalização/facial.
4. Só então requisitos, modelo de dados e fase no `20-ROADMAP.md`.
