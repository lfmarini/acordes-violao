// ---------------------------------------------------------------------------
// Ajustes do banco de acordes (@tombatossals/chords-db).
//
// O script `npm run verificar` confere cada forma do banco: calcula a nota de
// cada corda e compara com a teoria. As formas que ele apontou como erradas
// NÃO são removidas: cada uma é trocada por uma versão ajustada na mesma
// região do braço, mudando o mínimo possível (uma corda que muda de casa ou
// deixa de ser tocada). Todas as versões ajustadas passam pelo verificador.
// ---------------------------------------------------------------------------

interface Fix {
  frets: number[] // casas absolutas, 6ª → 1ª corda, -1 = x
  fingers: number[]
  why: string
}

/** "chave|sufixo do banco|casas originais" -> forma ajustada. */
export const FIXES: Record<string, Fix> = {
  // ---- Notas erradas ----
  'C|9|0,3,2,0,3,0': { frets: [-1, 3, 2, 3, 3, 3], fingers: [0, 2, 1, 3, 3, 3], why: 'faltava a sétima (Bb): 3ª corda na casa 3; 6ª corda (E) não tocada; 1ª corda na casa 3 (G)' },
  'C|9|8,10,8,7,8,10': { frets: [8, 10, 8, 9, 8, 10], fingers: [1, 3, 1, 2, 1, 4], why: 'faltava a terça (E): 3ª corda da casa 7 para a 9' },
  'Csharp|aug|-1,4,4,4,2,2': { frets: [-1, 4, 3, 2, 2, 1], fingers: [0, 4, 3, 2, 2, 1], why: '4ª corda casa 3 (F), 3ª casa 2 (A), 1ª casa 1 (F) no lugar de F#, B e F#' },
  'Csharp|aug|4,4,6,4,7,4': { frets: [-1, 4, 7, 6, 6, 5], fingers: [0, 1, 4, 3, 3, 2], why: 'refeita na mesma região: C#, A, C#, F, A (antes tinha G#, B e F#)' },
  'D|mmaj7|-1,5,3,2,2,0': { frets: [-1, 5, 3, 2, 2, -1], fingers: [0, 4, 3, 1, 2, 0], why: '1ª corda solta (E, uma nona) deixa de ser tocada' },
  'D|maj9|-1,5,4,6,4,-1': { frets: [-1, 5, 4, 6, 5, -1], fingers: [0, 2, 1, 4, 3, 0], why: '2ª corda da casa 4 (D#) para a 5 (E, a nona)' },
  'D|7#9|0,0,0,10,7,8': { frets: [-1, 0, 0, 10, 7, 8], fingers: [0, 0, 0, 4, 1, 2], why: '6ª corda solta (E) deixa de ser tocada' },
  'G|add9|-1,-1,3,2,1,4': { frets: [-1, -1, 5, 4, 3, 5], fingers: [0, 0, 3, 2, 1, 4], why: 'refeita nas 4 cordas agudas: G, B, D, A (antes F, A, C, G#)' },
  'A|dim|5,3,-1,4,3,-1': { frets: [5, 3, -1, 5, 4, -1], fingers: [3, 1, 0, 4, 2, 0], why: '3ª corda da casa 4 para a 5 (C) e 2ª da casa 3 para a 4 (Eb)' },
  'Bb|6|-1,13,11,11,10,-1': { frets: [-1, 13, 12, 12, 11, -1], fingers: [0, 4, 2, 3, 1, 0], why: '4ª, 3ª e 2ª cordas uma casa acima: D, G, Bb (antes C#, F#, A)' },
  'Bb|6|6,8,-1,7,8,6': { frets: [6, 8, -1, 7, 8, -1], fingers: [1, 3, 0, 2, 4, 0], why: 'digitação pedia 5 dedos: 1ª corda deixa de ser tocada' },
  'F|/A|5,3,3,5,6,0': { frets: [5, 3, 3, 5, 6, -1], fingers: [2, 1, 1, 3, 4, 0], why: 'F/A: 1ª corda solta (E) deixa de ser tocada' },
  'B|aug|-1,14,13,12,12,0': { frets: [-1, 14, 13, 12, 12, -1], fingers: [0, 4, 3, 1, 2, 0], why: '1ª corda solta (E) deixa de ser tocada' },

  // ---- Acordes de 13 com a 4ª (11ª), que não entra no 13 ----
  'C|13|3,3,3,3,5,5': { frets: [-1, 3, 2, 3, 5, 5], fingers: [0, 2, 1, 3, 4, 4], why: '4ª corda da casa 3 (F) para a 2 (E); 6ª corda não tocada' },
  'Csharp|13|-1,4,3,3,0,2': { frets: [-1, 4, 3, 3, 0, 1], fingers: [0, 4, 2, 3, 0, 1], why: '1ª corda da casa 2 (F#) para a 1 (F)' },
  'Csharp|13|4,4,4,4,6,6': { frets: [-1, 4, 3, 4, 6, 6], fingers: [0, 2, 1, 3, 4, 4], why: '4ª corda da casa 4 (F#) para a 3 (F); 6ª corda não tocada' },
  'Csharp|13|9,9,9,10,11,11': { frets: [9, -1, 9, 10, 11, 11], fingers: [1, 0, 2, 3, 4, 4], why: '5ª corda (F#) deixa de ser tocada' },
  'D|13|5,5,5,5,7,7': { frets: [-1, 5, 4, 5, 7, 7], fingers: [0, 2, 1, 3, 4, 4], why: '4ª corda da casa 5 (G) para a 4 (F#); 6ª corda não tocada' },
  'Eb|13|6,6,6,6,8,8': { frets: [-1, 6, 5, 6, 8, 8], fingers: [0, 2, 1, 3, 4, 4], why: '4ª corda da casa 6 (Ab) para a 5 (G); 6ª corda não tocada' },
  'Eb|13|11,10,10,0,9,9': { frets: [11, 10, 10, 0, 8, 9], fingers: [4, 3, 3, 0, 1, 2], why: '2ª corda da casa 9 (Ab) para a 8 (G)' },
  'Eb|13|11,11,11,12,13,13': { frets: [11, -1, 11, 12, 13, 13], fingers: [1, 0, 2, 3, 4, 4], why: '5ª corda (Ab) deixa de ser tocada' },
  'E|13|0,0,0,1,2,2': { frets: [0, -1, 0, 1, 2, 2], fingers: [0, 0, 0, 1, 2, 3], why: '5ª corda solta (A) deixa de ser tocada' },
  'E|13|7,7,7,7,9,9': { frets: [-1, 7, 6, 7, 9, 9], fingers: [0, 2, 1, 3, 4, 4], why: '4ª corda da casa 7 (A) para a 6 (G#); 6ª corda não tocada' },
  'F|13|1,1,1,2,3,3': { frets: [1, -1, 1, 2, 3, 3], fingers: [1, 0, 2, 3, 4, 4], why: '5ª corda (Bb) deixa de ser tocada' },
  'F|13|8,8,8,8,10,10': { frets: [-1, 8, 7, 8, 10, 10], fingers: [0, 2, 1, 3, 4, 4], why: '4ª corda da casa 8 (Bb) para a 7 (A); 6ª corda não tocada' },
  'Fsharp|13|2,2,1,3,0,0': { frets: [2, -1, 1, 3, -1, 0], fingers: [2, 0, 1, 3, 0, 0], why: '5ª corda (B) e 2ª corda solta (B) deixam de ser tocadas' },
  'Fsharp|13|2,2,2,3,4,4': { frets: [2, -1, 2, 3, 4, 4], fingers: [1, 0, 2, 3, 4, 4], why: '5ª corda (B) deixa de ser tocada' },
  'Fsharp|13|9,9,9,9,11,11': { frets: [-1, 9, 8, 9, 11, 11], fingers: [0, 2, 1, 3, 4, 4], why: '4ª corda da casa 9 (B) para a 8 (A#); 6ª corda não tocada' },
  'Ab|13|4,4,4,5,6,6': { frets: [4, -1, 4, 5, 6, 6], fingers: [1, 0, 2, 3, 4, 4], why: '5ª corda (C#) deixa de ser tocada' },
  'A|13|5,4,4,0,3,0': { frets: [5, 4, 4, 0, 2, 0], fingers: [4, 2, 3, 0, 1, 0], why: '2ª corda da casa 3 (D) para a 2 (C#)' },
  'Bb|13|6,5,0,0,4,4': { frets: [6, 5, 0, 0, 3, 4], fingers: [4, 3, 0, 0, 1, 2], why: '2ª corda da casa 4 (D#) para a 3 (D)' },
  'Bb|13|6,6,6,7,8,8': { frets: [6, -1, 6, 7, 8, 8], fingers: [1, 0, 2, 3, 4, 4], why: '5ª corda (Eb) deixa de ser tocada' },
  'B|13|2,2,2,2,4,4': { frets: [-1, 2, 1, 2, 4, 4], fingers: [0, 2, 1, 3, 4, 4], why: '4ª corda da casa 2 (E) para a 1 (D#); 6ª corda não tocada' },
  'B|13|7,7,7,8,9,9': { frets: [7, -1, 7, 8, 9, 9], fingers: [1, 0, 2, 3, 4, 4], why: '5ª corda (E) deixa de ser tocada' },
}

export const shapeKey = (key: string, suffix: string, frets: number[]) => `${key}|${suffix}|${frets.join(',')}`
