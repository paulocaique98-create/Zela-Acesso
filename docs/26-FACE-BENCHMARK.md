# 26 — Benchmark do reconhecimento facial (D-007 → D-028)

**O que é:** medição reprodutível para escolher o motor facial do Zela Pass. **O que NÃO é:** validação estatística do produto, teste de ataque de apresentação (ISO/IEC 30107-3) nem avaliação de viés demográfico. Ver §6.

## 1. Método

- **Script:** `node scripts/bench-face.mjs <pasta-de-fotos> <rotulos.json> [saida.json]` (`pnpm face:bench`). Roda o **mesmo código de produção** (`apps/reader/src/lib/face/engine.js`) no Chromium, via servidor Vite, e mede latência, rejeições de qualidade, AUC, EER e FAR/FRR por limiar. `BENCH_ENGINE=human-faceres` mede o descritor embutido do Human (1024 dimensões, cosseno) nas mesmas fotos. Nenhum vetor ou foto é gravado.
- **Conjunto A (pequeno, só sanidade):** 9 fotos de 3 pessoas (repositório de testes do DeepFace). Rótulos conferidos **a olho** (img1, 2, 5, 6, 7 e 11 são a mesma pessoa). 16 pares genuínos e 20 impostores.
- **Conjunto B (LFW):** 150 pares sorteados (semente 7; 75 mesma pessoa, 75 pessoas diferentes) do split `pairs/train` do LFW (espelho `logasja/lfw` no Hugging Face). 300 imagens. O motor recusa quadro com mais de um rosto (25 imagens) ou de lado (SFace: +11), como no quiosque; sobram **53 genuínos e 61 impostores (SFace)** e **61 e 64 (faceres, sem corte de pose)**. Fotos de internet, sem controle de pose, luz ou câmera.
- **Ambiente:** Chromium headless com WebGL por **software** (sem GPU), Windows 11. Latência portanto só como ordem de grandeza.

## 2. Resultados

| | SFace (escolhido) | faceres (Human embutido) |
|---|---|---|
| Conjunto A: AUC | 1,000 | 1,000 |
| Conjunto A: genuíno mín. × impostor máx. | 0,934 × 0,669 (escala do produto) | 0,648 × 0,581 (cosseno) |
| **Conjunto B: AUC** | **0,9985** | 0,9895 |
| **Conjunto B: EER** | **≈ 1,7 %** (FAR 1,6 %, FRR 1,9 %) | ≈ 4,8 % (FAR 4,7 %, FRR 4,9 %) |
| Conjunto B: sobreposição | pequena, na cauda | genuíno mín. 0,451 < impostor máx. 0,546 |
| Vetor | 128 float32 (684 caracteres em base64) | 1024 float32 |
| Latência por quadro (mediana, WebGL por software) | 1,2–1,6 s | 1,4 s |
| Carga dos modelos | SFace 38 MB + WASM 11 MB + Human ~3,5 MB | ~7 MB (Human) |
| Avaliação publicada do modelo | acurácia 0,994 no `tools/eval` do OpenCV Zoo (conjunto não conferido por mim) | nenhuma que eu tenha encontrado como identidade |

**SFace no conjunto B por limiar do produto** (escala 0–1, `similarityToScore`; 53 genuínos, 61 impostores):

| Limiar | Falso aceite | Falsa rejeição |
|---|---|---|
| 0,80 (mínimo permitido) | 0 / 61 | 3,8 % |
| 0,85 (sugerido) | 0 / 61 | 7,5 % |
| 0,90 (padrão do banco) | 0 / 61 | 15,1 % |
| 0,95 | 0 / 61 | 30,2 % |

Leitura honesta: **zero falsos aceites em 61 impostores não prova taxa de falso aceite baixa**; a regra dos três dá, com 95 % de confiança, FAR < ~5 %. Em câmera frontal e boa luz a falsa rejeição tende a ser menor que a das fotos de internet do LFW, mas **isso não foi medido**. O limiar 0,90 é rígido para o quiosque (a captura média 5 quadros, o que ajuda); por isso a sugestão inicial é 0,85, a calibrar com dados da própria operação.

Antispoof/liveness do Human em fotos digitais (conjunto A): `real` entre 0,29 e 0,83 e `live` entre 0,65 e 1,00, ou seja, **fotos de rosto passam como "reais" na maioria dos casos**. Não houve teste com foto impressa ou tela filmada. Conclusão: a prova de vida passiva **não deve ser vendida como proteção contra foto/vídeo**.

## 3. Primeira rodada descartada (erro meu, registrado)

A primeira medição do descritor do Human (faceres, faceres-deep, MobileFaceNet, MobileFace) usou rótulos errados: eu tinha separado as fotos A (1, 2, 11) e C (5, 6, 7) como pessoas diferentes, mas são a mesma pessoa. O "impostor" mais parecido (0,85–0,89) era um par genuíno, e concluí, errado, que o faceres era inadequado. Corrigidos os rótulos e repetido nas mesmas condições (§2), o faceres separa bem o conjunto pequeno e fica **atrás do SFace no LFW** (EER cerca de 2,8 vezes maior). **A escolha do SFace repousa na tabela acima, não na primeira rodada.** MobileFaceNet e MobileFace do Human renderam desempenho próximo do acaso no pipeline do Human (AUC 0,5–0,65), mas essa medida também usou os rótulos errados e **não foi refeita**: HIPÓTESE, sem conclusão.

## 4. Decisão (D-028)

- **Reconhecimento:** SFace (Apache-2.0) em `onnxruntime-web` (MIT) no navegador; Human (MIT) só para detecção, malha e prova de vida passiva. `face-api.js` não é usado.
- **Pontuação:** o cosseno 0,363 (limiar do código oficial do SFace no OpenCV Zoo, `sface.py`; a taxa de falso aceite nesse ponto **não foi verificada por mim**) vira 0,80, o piso do limiar; ≥ 0,75 vira 1,00. No conjunto B, o falso aceite a 0,80 foi 0/61.
- **Liveness:** capacidade declarada, eficácia **não validada**.

## 5. Licenças e procedência

| Componente | Licença | Observação |
|---|---|---|
| @vladmandic/human 3.3.6 | MIT | modelos `blazeface`, `facemesh`, `antispoof`, `liveness` vêm no pacote npm |
| onnxruntime-web 1.22.0 | MIT | WASM servido pelo próprio Edge |
| SFace `face_recognition_sface_2021dec.onnx` | Apache-2.0 (repositório OpenCV Zoo) | SHA-256 `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` conferido por `scripts/fetch-face-models.mjs`. **A licença dos dados com que o modelo foi treinado não foi verificada por mim** (artigo: arXiv 2205.12010). **PENDENTE de validação jurídica** antes de uso comercial amplo. |

## 6. Limites e o que falta para validar de verdade

1. **Tamanho:** 53–61 pares por classe. Para afirmar FAR de 0,1 % são necessários dezenas de milhares de comparações impostoras.
2. **Condições:** fotos de internet, não câmera de tablet na portaria; sem variação controlada de luz, ângulo, óculos, máscara, barba.
3. **Viés demográfico:** não avaliado. Obrigatório medir com a população da Alfa, **com consentimento e base legal**, antes de operação.
4. **Ataque de apresentação:** não testado (foto impressa, tela, vídeo, máscara). Fazer com a metodologia da ISO/IEC 30107-3 ou terceiro especializado.
5. **Latência e consumo:** medidos só em software. Medir em tablet real (CPU/GPU, temperatura, bateria).
6. **Reprodução:** `pnpm face:models`, depois `pnpm face:bench <pasta> <rotulos.json>`. As fotos não estão no repositório.
