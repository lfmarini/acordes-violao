import { Chord, Interval, Note } from 'tonal'
import { OPEN_STRINGS, chordTonalName, type ChordRef } from './chords'

// ---------------------------------------------------------------------------
// Mapeamento nota -> grau.
// O tonal nos dá, para um acorde, a lista de notas e a lista de intervalos
// (na mesma ordem). Ex.: Chord.get("C7") -> notas [C, E, G, Bb] e
// intervalos [1P, 3M, 5P, 7m]. O número do intervalo diz o grau
// (3 = terça, 7 = sétima...) e a letra diz a qualidade (M = maior, m = menor,
// P = justa, d = diminuta, A = aumentada).
// ---------------------------------------------------------------------------

export type DegreeId = 'root' | 'third' | 'fifth' | 'seventh' | 'ninth' | 'fourth' | 'sixth'

// Nome de cada grau. As cores ficam nos temas (src/lib/themes.ts).
export const DEGREES: Record<DegreeId, { name: string }> = {
  root: { name: 'Fundamental' },
  third: { name: 'Terça' },
  fifth: { name: 'Quinta' },
  seventh: { name: 'Sétima' },
  ninth: { name: 'Nona' },
  fourth: { name: 'Quarta' },
  sixth: { name: 'Sexta' },
}

// Graus que sempre aparecem no painel (mesmo ausentes, em cinza).
export const CORE_DEGREES: DegreeId[] = ['root', 'third', 'fifth', 'seventh', 'ninth']

// Número do intervalo -> grau. A nona (9) é a segunda (2) uma oitava acima,
// por isso as duas caem no mesmo grau; o mesmo vale para 4/11 e 6/13.
function degreeOf(num: number): DegreeId {
  switch (num) {
    case 1: return 'root'
    case 3: return 'third'
    case 5: return 'fifth'
    case 7: return 'seventh'
    case 2: case 9: return 'ninth'
    case 4: case 11: return 'fourth'
    default: return 'sixth' // 6 e 13
  }
}

const QUALITY_WORD: Record<string, string> = {
  M: 'maior', m: 'menor', P: 'justa', d: 'diminuta', A: 'aumentada',
  dd: 'duplamente diminuta', AA: 'duplamente aumentada',
}
const ORDINAL: Record<number, string> = {
  1: 'fundamental', 2: 'segunda', 3: 'terça', 4: 'quarta', 5: 'quinta', 6: 'sexta',
  7: 'sétima', 9: 'nona', 11: 'décima primeira', 13: 'décima terceira',
}

// "3M" -> "terça maior"; "1P" -> "tônica".
export function describeInterval(ivl: string) {
  const i = Interval.get(ivl)
  if (i.num === 1) return 'tônica'
  return `${ORDINAL[i.num] ?? `${i.num}ª`} ${QUALITY_WORD[i.q] ?? ''}`.trim()
}

export interface Member {
  note: string // grafia da nota no acorde (ex.: "Bb")
  interval: string // ex.: "7m"
  degree: DegreeId
  chroma: number
}

export interface DegreeRow {
  degree: DegreeId
  present: Member[]
  // Quando o grau não está no acorde: as notas que ele "seria".
  missing: { note: string; interval: string }[]
}

export interface Analysis {
  members: Member[]
  byChroma: Map<number, Member>
  rows: DegreeRow[]
}

// Se o grau estiver ausente, mostramos qual nota ele seria (em cinza).
// Terça e sétima têm duas possibilidades comuns (maior e menor).
const MISSING_CANDIDATES: Partial<Record<DegreeId, string[]>> = {
  third: ['3M', '3m'],
  fifth: ['5P'],
  seventh: ['7m', '7M'],
  ninth: ['9M'],
}

export function analyze(ref: ChordRef): Analysis {
  const chord = Chord.get(chordTonalName(ref))
  const members: Member[] = chord.intervals.map((interval, k) => ({
    note: chord.notes[k],
    interval,
    degree: degreeOf(Interval.get(interval).num ?? 1),
    chroma: Note.chroma(chord.notes[k]) ?? 0,
  }))
  const byChroma = new Map(members.map((m) => [m.chroma, m]))

  const used = new Set(members.map((m) => m.degree))
  const order: DegreeId[] = [
    ...CORE_DEGREES,
    ...(['fourth', 'sixth'] as DegreeId[]).filter((d) => used.has(d)),
  ]
  const rows = order.map((degree) => {
    const present = members.filter((m) => m.degree === degree)
    const missing = present.length
      ? []
      : (MISSING_CANDIDATES[degree] ?? []).map((interval) => ({
          interval,
          note: Note.pitchClass(Note.transpose(ref.root, interval)),
        }))
    return { degree, present, missing }
  })
  return { members, byChroma, rows }
}

// Altura real da nota numa corda: corda solta transposta por N semitons
// (cada casa = 1 semitom). Ex.: 5ª corda (A2) na 3ª casa -> C3.
export function noteAt(stringIndex: number, fret: number) {
  return Note.transpose(OPEN_STRINGS[stringIndex], Interval.fromSemitones(fret))
}

export function chromaAt(stringIndex: number, fret: number) {
  return Note.chroma(noteAt(stringIndex, fret)) ?? 0
}
