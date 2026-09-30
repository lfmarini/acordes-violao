// ---------------------------------------------------------------------------
// Correções do banco de acordes (@tombatossals/chords-db).
//
// O script `npm run verificar` confere cada forma do banco: calcula a nota de
// cada corda e compara com a teoria. Aqui ficam as formas que ele apontou
// como erradas (removidas) e as formas-padrão que colocamos no lugar.
//
// As formas acrescentadas são digitações clássicas e conhecidas (não são
// calculadas do zero): o "13" com a tônica na 6ª corda (ex.: G13 = 3 x 3 4 5 x),
// o "13" com a tônica na 5ª corda (ex.: C13 = x 3 2 3 5 5) e o aumentado com a
// tônica na 5ª corda (ex.: C+ = x 3 2 1 1 x), só levados para a tônica certa.
// Todas passam pelo mesmo verificador.
// ---------------------------------------------------------------------------

import type { Barre } from './chords'

/** Formas removidas: "chave|sufixo do banco|casas absolutas (6ª→1ª, -1 = x)". */
export const REMOVED = new Set([
  // Notas erradas
  'C|9|0,3,2,0,3,0', // sem a sétima: é um Cadd9
  'C|9|8,10,8,7,8,10', // sem a terça
  'Csharp|aug|-1,4,4,4,2,2', // notas de outro acorde
  'Csharp|aug|4,4,6,4,7,4', // notas de outro acorde
  'D|mmaj7|-1,5,3,2,2,0', // a 1ª corda solta acrescenta uma nona
  'D|maj9|-1,5,4,6,4,-1', // D# no lugar do E
  'D|7#9|0,0,0,10,7,8', // 6ª corda solta (E) fora do acorde
  'G|add9|-1,-1,3,2,1,4', // notas de outro acorde
  'A|dim|5,3,-1,4,3,-1', // B e D fora do acorde, sem o Eb
  'Bb|6|-1,13,11,11,10,-1', // notas de outro acorde
  'Bb|6|6,8,-1,7,8,6', // digitação impossível (pede 5 dedos)
  'B|aug|-1,14,13,12,12,0', // 1ª corda solta (E) fora do acorde
  // Acordes de 13 com a 4ª (11ª), que não entra no 13
  'C|13|3,3,3,3,5,5',
  'Csharp|13|-1,4,3,3,0,2',
  'Csharp|13|4,4,4,4,6,6',
  'Csharp|13|9,9,9,10,11,11',
  'D|13|5,5,5,5,7,7',
  'Eb|13|6,6,6,6,8,8',
  'Eb|13|11,10,10,0,9,9',
  'Eb|13|11,11,11,12,13,13',
  'E|13|0,0,0,1,2,2',
  'E|13|7,7,7,7,9,9',
  'F|13|1,1,1,2,3,3',
  'F|13|8,8,8,8,10,10',
  'Fsharp|13|2,2,1,3,0,0',
  'Fsharp|13|2,2,2,3,4,4',
  'Fsharp|13|9,9,9,9,11,11',
  'Ab|13|4,4,4,5,6,6',
  'A|13|5,4,4,0,3,0',
  'Bb|13|6,5,0,0,4,4',
  'Bb|13|6,6,6,7,8,8',
  'B|13|2,2,2,2,4,4',
  'B|13|7,7,7,8,9,9',
])

export interface ExtraShape {
  frets: number[] // absolutas, -1 = x
  fingers: number[]
  barres: Barre[]
}

const DB_KEYS = ['C', 'Csharp', 'D', 'Eb', 'E', 'F', 'Fsharp', 'G', 'Ab', 'A', 'Bb', 'B']

// 13 com a tônica na 6ª corda: T x 7m 3 13 x  (ex.: G13 = 3 x 3 4 5 x)
function thirteenOn6(r: number): ExtraShape {
  if (r === 0) return { frets: [0, -1, 0, 1, 2, -1], fingers: [0, 0, 0, 1, 2, 0], barres: [] } // E13
  return { frets: [r, -1, r, r + 1, r + 2, -1], fingers: [1, 0, 2, 3, 4, 0], barres: [] }
}
// 13 com a tônica na 5ª corda: x T 3 7m 3 13  (ex.: C13 = x 3 2 3 5 5)
function thirteenOn5(r: number): ExtraShape {
  if (r === 0) return { frets: [-1, 0, 2, 0, 2, 2], fingers: [0, 0, 1, 0, 2, 3], barres: [] } // A13
  if (r === 1) return { frets: [-1, 1, 0, 1, 3, 3], fingers: [0, 1, 0, 2, 4, 4], barres: [{ fret: 3, from: 4, to: 5, finger: 4 }] } // Bb13
  return {
    frets: [-1, r, r - 1, r, r + 2, r + 2],
    fingers: [0, 2, 1, 3, 4, 4],
    barres: [{ fret: r + 2, from: 4, to: 5, finger: 4 }],
  }
}

/** Formas acrescentadas: chave do banco -> sufixo -> formas. */
export const ADDED: Record<string, Record<string, ExtraShape[]>> = {}
const add = (key: string, suffix: string, s: ExtraShape) => {
  ADDED[key] ??= {}
  ;(ADDED[key][suffix] ??= []).push(s)
}

DB_KEYS.forEach((key, chroma) => {
  const r6 = (chroma - 4 + 12) % 12 // casa da tônica na 6ª corda (E)
  const r5 = (chroma - 9 + 12) % 12 // casa da tônica na 5ª corda (A)
  add(key, '13', thirteenOn6(r6))
  add(key, '13', thirteenOn5(r5))
})
// C#+ ficou só com 2 formas: acrescentamos a do aumentado na 5ª corda (x 4 3 2 2 x).
add('Csharp', 'aug', { frets: [-1, 4, 3, 2, 2, -1], fingers: [0, 4, 3, 1, 2, 0], barres: [] })

export const shapeKey = (key: string, suffix: string, frets: number[]) => `${key}|${suffix}|${frets.join(',')}`
