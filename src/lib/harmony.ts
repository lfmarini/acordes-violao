import { Chord, Key, Note } from 'tonal'
import type { ChordRef } from './chords'
import { chordTonalName } from './chords'
import { parseChord } from './parser'

// ---------------------------------------------------------------------------
// Campo harmônico: os 7 acordes formados sobre cada nota da escala da
// tonalidade cuja tônica é o acorde escolhido. Tudo vem do tonal (Key).
// ---------------------------------------------------------------------------

export type Mode = 'major' | 'minor'

export const DEGREE_NAMES = ['tônica', 'sobretônica', 'mediante', 'subdominante', 'dominante', 'sobredominante', 'sensível']

export interface FieldChord {
  numeral: string // ex.: "ii", "V", "vii°"
  name: string // nome do grau (tônica, dominante...)
  triad: ChordRef | null
  tetrad: ChordRef | null
}

// Acordes maiores ou suspensos puxam a tonalidade maior; com terça menor
// (menor, diminuto, meio-diminuto), a menor.
export function defaultMode(ref: ChordRef): Mode {
  const ivls = Chord.get(chordTonalName(ref)).intervals
  return ivls.includes('3m') && !ivls.includes('3M') ? 'minor' : 'major'
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

// Algarismo romano: maiúsculo para acorde maior, minúsculo para menor,
// com "°" no diminuto e "+" no aumentado.
function numeralFor(i: number, triad: string, flat: boolean) {
  const c = Chord.get(triad)
  const base = (flat ? '♭' : '') + ROMAN[i]
  if (c.quality === 'Minor') return base.toLowerCase()
  if (c.quality === 'Diminished') return base.toLowerCase() + '°'
  if (c.quality === 'Augmented') return base + '+'
  return base
}

const toRef = (symbol: string) => {
  const r = parseChord(symbol)
  return r.ok ? r.chord : null
}

export function harmonicField(root: string, mode: Mode): FieldChord[] {
  const tonic = Note.pitchClass(root)
  const k = mode === 'major' ? Key.majorKey(tonic) : Key.minorKey(tonic).natural
  return k.triads.map((triad, i) => ({
    numeral: numeralFor(i, triad, k.grades[i].startsWith('b')),
    // Na menor natural, o VII fica um tom abaixo da tônica: é a "subtônica".
    // A sensível (meio tom abaixo) só existe na menor harmônica.
    name: mode === 'minor' && i === 6 ? 'subtônica' : DEGREE_NAMES[i],
    triad: toRef(triad),
    tetrad: toRef(k.chords[i]),
  }))
}

export function keyInfo(root: string, mode: Mode) {
  const tonic = Note.pitchClass(root)
  const alteration = mode === 'major' ? Key.majorKey(tonic).alteration : Key.minorKey(tonic).alteration
  const relative = mode === 'major' ? Key.majorKey(tonic).minorRelative + 'm' : Key.minorKey(tonic).relativeMajor
  const signature =
    alteration === 0 ? 'sem sustenidos nem bemóis' : `${Math.abs(alteration)} ${alteration > 0 ? '♯' : '♭'} na armadura`
  return { tonic, alteration, relative, signature }
}
