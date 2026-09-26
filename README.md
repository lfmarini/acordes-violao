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
  cada corda na altura real (corda solta + casa).
- **Favoritos** com estrela e lembrança do último acorde, tudo salvo no navegador.

## Tecnologias

Vite, React, TypeScript, Tailwind CSS, [tonal](https://github.com/tonaljs/tonal)
(teoria musical), [@tombatossals/chords-db](https://github.com/tombatossals/chords-db)
(formas de acordes, licença MIT), tone.js (som sintetizado), framer-motion
(animações), three.js com @react-three/fiber e drei (fundo e visão 3D) e
vite-plugin-pwa (modo offline).

## Onde mexer

| Quero mudar... | Arquivo |
| --- | --- |
| Atraso entre as cordas no play (`STRUM_DELAY_MS`) | `src/lib/audio.ts` |
| Cores de cada grau | `src/lib/theory.ts` |
| Tradução da cifra brasileira | `src/lib/parser.ts` |
| Qualidades de acorde da lista | `src/lib/chords.ts` |
| Desenho do braço | `src/components/Fretboard.tsx` |

## Rodando no computador

Precisa do [Node.js](https://nodejs.org/en/download). Na pasta do projeto:

```bash
npm install
npm run dev
```

Outros comandos: `npm run build` (gera a versão final), `npm run testar`
(confere o tradutor de cifras com uma lista de acordes) e `npm run icones`
(gera os ícones do app).

## Publicação

O site é publicado na Vercel com `vercel --prod`.
