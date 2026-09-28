# Acordes Violão

Site (PWA) para estudar acordes de violão. Você escolhe um acorde e ele aparece
desenhado no braço do violão, com um painel explicando a teoria de cada grau e
um botão para ouvir o acorde. Funciona offline e pode ser instalado no celular
e no computador.

**No ar:** https://acordes-violao.vercel.app

## O que ele faz

- **Braço em 2D (SVG)**, na vertical: 6ª corda (Mi grave) à esquerda e 1ª
  (Mi agudo) à direita. Mostra cerca de 5 casas, a casa inicial, `X` para corda
  que não toca e `O` para corda solta.
- **Dedos**: com o botão ligado, cada círculo mostra o número do dedo
  (1 indicador, 2 médio, 3 anelar, 4 mínimo). A pestana é uma barra contínua.
- **Destro/canhoto**: espelha o diagrama.
- **Escolha do acorde** pela lista (tônica e qualidade) ou digitando, em notação
  brasileira (`C7M`, `D°`, `A+`, `Bm7(b5)`) ou internacional (`Cmaj7`, `Ddim`).
- **Variações**: miniaturas de todas as formas do acorde, da posição aberta
  para a mais aguda. As setas ← → do teclado também navegam.
- **Painel de teoria**: fundamental, terça, quinta, sétima e nona, com a nota e
  a qualidade. Graus ausentes aparecem em cinza. Cada grau tem uma cor, e os
  círculos do braço usam a mesma cor. Passe o mouse num grau para ver a nota no
  braço.
- **Play**: toca o acorde da 6ª para a 1ª corda, pulando as cordas com `X`,
  cada corda na altura real (corda solta + casa, com A4 = 440 Hz: a 6ª corda
  solta é E2 = 82,41 Hz). O som é gerado por um modelo de corda de violão
  (Karplus-Strong) com filtros que imitam o corpo do instrumento. Embaixo de
  cada corda aparecem a nota que soa e a frequência.
- **Velocidade do ataque**: um cursor vai de 10 ms (rápido) a 100 ms (lento)
  entre uma corda e a próxima; o meio é 32 ms.
- **Campo harmônico**: os 7 acordes do tom do acorde escolhido (I tônica,
  II sobretônica, III mediante, IV subdominante, V dominante, VI
  sobredominante, VII sensível), em tríade e com sétima, no tom maior ou menor.
- **Círculo de quintas** com o tom destacado e os vizinhos do campo harmônico.
- **Capturar acorde** (tipo Shazam): o app ouve o violão pelo microfone,
  descobre as notas que estão soando e mostra os acordes mais prováveis. O som
  é analisado só no navegador, nada é enviado para a internet.
- **Aba Aprendizado**: metrônomo de 40 a 200 BPM (com acento no 1º tempo,
  compasso de 1 a 8 tempos, "bater o tempo" e volume) e gráfico da amplitude
  sonora captada pelo microfone nos últimos 8 segundos, com as batidas do
  metrônomo marcadas para conferir se você está no tempo. Enquanto o microfone
  está ligado o som é gravado, e dá para salvar um arquivo MP3 (padrão, ~1 MB
  por minuto) ou WAV (sem perda, ~6x maior) com os últimos
  10 s, 30 s, 1 min ou a gravação inteira. Uma trilha pequena abaixo do gráfico
  mostra o último minuto: arraste nela para ver outro trecho no gráfico de 8 s
  (com o replay aberto, o áudio pula para o mesmo ponto e o gráfico acompanha).
  O botão pequeno "Tempo real", no canto do gráfico, prende o gráfico no agora. Com o microfone ligado, o quadro "Tocando agora"
  identifica a nota (com a afinação em cents) ou o acorde que está soando e
  marca cada troca no gráfico. Dá para ouvir a última gravação no próprio app,
  escolher se o som do metrônomo entra no arquivo e ligar a redução de ruído
  (fraca, média ou forte), que tira chiado e barulho constante do ambiente.
- **Favoritos** com estrela e lembrança do último acorde, tudo salvo no navegador.

## Tecnologias

Vite, React, TypeScript, Tailwind CSS, [tonal](https://github.com/tonaljs/tonal)
(teoria musical), [@tombatossals/chords-db](https://github.com/tombatossals/chords-db)
(formas de acordes, licença MIT), tone.js (som sintetizado), framer-motion
(animações), three.js com @react-three/fiber e drei (fundo animado) e
vite-plugin-pwa (modo offline) e [lamejs](https://github.com/breezystack/lamejs)
(conversão para MP3, licença LGPL).

## Onde mexer

| Quero mudar... | Arquivo |
| --- | --- |
| Atraso padrão e limites do ataque (`STRUM_DELAY_MS`) | `src/lib/audio.ts` |
| Timbre da corda (sustentação, brilho) | `src/lib/ks.ts` e `src/lib/audio.ts` |
| Cores de cada grau | `src/lib/theory.ts` |
| Tradução da cifra brasileira | `src/lib/parser.ts` |
| Qualidades de acorde da lista | `src/lib/chords.ts` |
| Campo harmônico | `src/lib/harmony.ts` |
| Reconhecimento de acordes pelo som | `src/lib/recognize.ts` |
| Metrônomo (limites de BPM, som do clique) | `src/lib/metronome.ts` |
| Gravação, MP3/WAV e qualidade do MP3 (`MP3_KBPS`) | `src/lib/recorder.ts` |
| Identificação ao vivo de nota/acorde | `src/lib/liveDetect.ts` |
| Estilo dos botões (`.btn`) | `src/index.css` |
| Redução de ruído (níveis fraca/média/forte) | `src/lib/denoise.ts` |
| Gráfico de amplitude | `src/components/AmplitudeChart.tsx` |
| Desenho do braço | `src/components/Fretboard.tsx` |

## Rodando no computador

Precisa do [Node.js](https://nodejs.org/en/download). Na pasta do projeto:

```bash
npm install
npm run dev
```

Outros comandos: `npm run build` (gera a versão final), `npm run testar`
(confere o tradutor de cifras com uma lista de acordes), `npm run afinacao`
(mede a frequência do som gerado em cada corda) e `npm run reconhecimento`
(testa o reconhecedor com acordes sintetizados) e `npm run ruido` (mede
quanto a redução de ruído tira do chiado e quanto preserva da nota) e `npm run icones`
(gera os ícones do app).

## Publicação

O site é publicado na Vercel com `vercel --prod`.
