import guitar from '@tombatossals/chords-db/lib/guitar.json'
import { Chord, Interval, Note } from 'tonal'
import { ADDED, REMOVED, shapeKey, type ExtraShape } from './chordFixes'

// ---------------------------------------------------------------------------
// Banco de formas: @tombatossals/chords-db (licença MIT).
// Cada forma vem com casas, dedos e pestanas já definidos por gente que toca.
// Nada aqui é "inventado" por cálculo: só convertemos o formato do banco.
// ---------------------------------------------------------------------------

interface DbPosition {
  frets: number[] // -1 = corda não tocada, 0 = solta, n = casa RELATIVA à baseFret
  fingers: number[] // 0 = sem dedo, 1..4 = indicador..mínimo
  barres: number[] // casas (relativas) onde há pestana
  baseFret: number
  capo?: boolean
}
interface DbChord {
  key: string
  suffix: string
  positions: DbPosition[]
}
const db = guitar as unknown as { chords: Record<string, DbChord[]> }

// Afinação padrão. Índice 0 = 6ª corda (Mi grave), índice 5 = 1ª corda (Mi agudo).
export const OPEN_STRINGS = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] as const
export const STRING_NAMES = ['6ª', '5ª', '4ª', '3ª', '2ª', '1ª'] as const
export const STRING_NOTES = ['E', 'A', 'D', 'G', 'B', 'e'] as const

export interface Barre {
  fret: number // casa absoluta
  from: number // índice da corda mais grave coberta
  to: number // índice da corda mais aguda coberta
  finger: number
}

export interface Shape {
  frets: number[] // casas ABSOLUTAS: -1 abafada, 0 solta, n casa
  fingers: number[] // 0 = sem número (sem dedo ou sem informação)
  barres: Barre[]
  baseFret: number // primeira casa mostrada na janela do diagrama
  isOpen: boolean
  /** A tônica não soa (posição de jazz, pensada para tocar com baixista). */
  rootless?: boolean
  label: string // "Aberto", "3ª casa"...
}

// Tônicas da lista navegável. `name` é a grafia usada na teoria.
export const ROOTS = [
  { name: 'C', label: 'C' },
  { name: 'C#', label: 'C#/Db' },
  { name: 'D', label: 'D' },
  { name: 'Eb', label: 'D#/Eb' },
  { name: 'E', label: 'E' },
  { name: 'F', label: 'F' },
  { name: 'F#', label: 'F#/Gb' },
  { name: 'G', label: 'G' },
  { name: 'Ab', label: 'G#/Ab' },
  { name: 'A', label: 'A' },
  { name: 'Bb', label: 'A#/Bb' },
  { name: 'B', label: 'B' },
] as const

// Chaves das tônicas no banco, na ordem do "chroma" (C=0, C#=1 ... B=11).
const DB_KEYS = ['C', 'Csharp', 'D', 'Eb', 'E', 'F', 'Fsharp', 'G', 'Ab', 'A', 'Bb', 'B']

// Qualidades. `br` = como escrevemos no Brasil (é o que aparece na tela),
// `tonal` = notação internacional que o tonal entende, `db` = sufixo no banco.
export const QUALITIES = [
  { id: 'maior', br: '', tonal: '', db: 'major', name: 'maior' },
  { id: 'menor', br: 'm', tonal: 'm', db: 'minor', name: 'menor' },
  { id: '7', br: '7', tonal: '7', db: '7', name: 'com sétima' },
  { id: '7M', br: '7M', tonal: 'maj7', db: 'maj7', name: 'com sétima maior' },
  { id: 'm7', br: 'm7', tonal: 'm7', db: 'm7', name: 'menor com sétima' },
  { id: 'm7M', br: 'm7M', tonal: 'mMaj7', db: 'mmaj7', name: 'menor com sétima maior' },
  { id: '6', br: '6', tonal: '6', db: '6', name: 'com sexta' },
  { id: 'm6', br: 'm6', tonal: 'm6', db: 'm6', name: 'menor com sexta' },
  { id: '9', br: '9', tonal: '9', db: '9', name: 'com sétima e nona' },
  { id: 'add9', br: 'add9', tonal: 'add9', db: 'add9', name: 'com nona adicionada' },
  { id: 'm9', br: 'm9', tonal: 'm9', db: 'm9', name: 'menor com sétima e nona' },
  { id: '7M9', br: '7M(9)', tonal: 'maj9', db: 'maj9', name: 'sétima maior e nona' },
  { id: 'dim', br: '°', tonal: 'dim', db: 'dim', name: 'diminuto' },
  { id: 'dim7', br: '°7', tonal: 'dim7', db: 'dim7', name: 'diminuto com sétima' },
  { id: 'm7b5', br: 'm7(b5)', tonal: 'm7b5', db: 'm7b5', name: 'meio-diminuto' },
  { id: 'aug', br: '+', tonal: 'aug', db: 'aug', name: 'aumentado' },
  { id: 'sus2', br: 'sus2', tonal: 'sus2', db: 'sus2', name: 'suspenso com segunda' },
  { id: 'sus4', br: 'sus4', tonal: 'sus4', db: 'sus4', name: 'suspenso com quarta' },
  { id: '7sus4', br: '7sus4', tonal: '7sus4', db: '7sus4', name: 'sétima com quarta suspensa' },
  { id: '7b9', br: '7(b9)', tonal: '7b9', db: '7b9', name: 'sétima com nona menor' },
  { id: '7#9', br: '7(#9)', tonal: '7#9', db: '7#9', name: 'sétima com nona aumentada' },
  { id: '13', br: '13', tonal: '13', db: '13', name: 'com décima terceira' },
] as const
export type Quality = (typeof QUALITIES)[number]

// "Impressão digital" de um acorde: os semitons de cada intervalo a partir da
// tônica. Serve para reconhecer que "C7M", "Cmaj7" e "CM7" são o mesmo acorde.
function fingerprint(semitones: number[]) {
  return [...new Set(semitones.map((s) => ((s % 12) + 12) % 12))].sort((a, b) => a - b).join(',')
}
const semitonesOf = (intervals: string[]) => intervals.map((i) => Interval.semitones(i) ?? 0)
const QUALITY_BY_PRINT = new Map(
  QUALITIES.map((q) => [fingerprint(semitonesOf(Chord.get('C' + q.tonal).intervals)), q] as const),
)

export function qualityOfTonalChord(intervals: string[]): Quality | undefined {
  return QUALITY_BY_PRINT.get(fingerprint(semitonesOf(intervals)))
}

/** Qualidade cujas notas, a partir da tônica, são exatamente estes semitons (0 = tônica). */
export function qualityOfSemitones(semitones: number[]): Quality | undefined {
  return QUALITY_BY_PRINT.get(fingerprint(semitones))
}

export interface ChordRef {
  root: string // grafia da tônica (ex.: "Bb")
  quality: Quality
}

export const chordDisplayName = (c: ChordRef) => c.root + c.quality.br
export const chordTonalName = (c: ChordRef) => c.root + c.quality.tonal

// Converte uma forma do banco (casas relativas) para casas absolutas.
function toShape(p: DbPosition): Omit<Shape, 'label'> {
  const frets = p.frets.map((f) => (f <= 0 ? f : f + p.baseFret - 1))
  let fingers = [...p.fingers]
  // Se a forma não tiver digitação, sugerimos uma coerente (ver função).
  if (!fingers.some((f) => f > 0)) fingers = suggestFingers(frets)

  const barres: Barre[] = p.barres.map((rel) => {
    const fret = rel + p.baseFret - 1
    const onFret = frets.flatMap((f, i) => (f === fret ? [i] : []))
    const finger = fingers[onFret[0]] || 1
    const covered = onFret.filter((i) => fingers[i] === finger)
    return { fret, from: Math.min(...covered), to: Math.max(...covered), finger }
  })

  const isOpen = p.baseFret === 1 && frets.some((f) => f === 0)
  return { frets, fingers, barres, baseFret: p.baseFret, isOpen }
}

// Sugestão de digitação para formas sem essa informação: a casa mais baixa
// recebe o dedo mais baixo, a mais alta o mais alto. Só sugerimos quando cabe
// em 4 dedos sem pestana; caso contrário, os círculos ficam sem número
// (melhor não mostrar do que ensinar uma digitação errada).
// Forma acrescentada à mão -> mesmo formato das formas do banco.
function fromExtra(x: ExtraShape): Omit<Shape, 'label'> {
  const pressed = x.frets.filter((f) => f > 0)
  const baseFret = !pressed.length || Math.max(...pressed) <= 4 ? 1 : Math.min(...pressed)
  const isOpen = baseFret === 1 && x.frets.some((f) => f === 0)
  return { frets: [...x.frets], fingers: [...x.fingers], barres: x.barres, baseFret, isOpen }
}

function suggestFingers(frets: number[]) {
  const pressed = frets.filter((f) => f > 0)
  const distinct = [...new Set(pressed)].sort((a, b) => a - b)
  if (pressed.length === 0 || pressed.length > 4) return frets.map(() => 0)
  let next = 1
  const byFret = new Map<number, number>()
  for (const f of distinct) byFret.set(f, next++)
  const used = new Set<number>()
  return frets.map((f) => {
    if (f <= 0) return 0
    let finger = byFret.get(f)!
    while (used.has(finger)) finger++
    if (finger > 4) return 0
    used.add(finger)
    return finger
  })
}

// Alguma corda tocada soa a nota com esse chroma (0 = C ... 11 = B)?
function soundsChroma(frets: number[], chroma: number) {
  return frets.some((f, s) => f >= 0 && (Note.midi(OPEN_STRINGS[s])! + f) % 12 === chroma)
}

function positionLabel(s: Omit<Shape, 'label'>) {
  if (s.isOpen) return 'Aberto'
  const pressed = s.frets.filter((f) => f > 0)
  return `${pressed.length ? Math.min(...pressed) : s.baseFret}ª casa`
}

// Todas as variações de um acorde, da mais grave/aberta para a mais aguda.
export function shapesFor(ref: ChordRef): Shape[] {
  const chroma = Note.chroma(ref.root)
  if (chroma === undefined) return []
  const entry = db.chords[DB_KEYS[chroma]]?.find((c) => c.suffix === ref.quality.db)
  if (!entry) return []
  const lowest = (s: Omit<Shape, 'label'>) => {
    const pressed = s.frets.filter((f) => f > 0)
    return pressed.length ? Math.min(...pressed) : 0
  }
  // Correções verificadas (ver chordFixes.ts): tira as formas erradas do
  // banco e acrescenta formas-padrão onde faltava.
  const key = DB_KEYS[chroma]
  const fromDb = entry.positions.map(toShape).filter((s) => !REMOVED.has(shapeKey(key, entry.suffix, s.frets)))
  const known = new Set(fromDb.map((s) => s.frets.join(',')))
  const extra = (ADDED[key]?.[entry.suffix] ?? []).filter((x) => !known.has(x.frets.join(','))).map(fromExtra)
  return [...fromDb, ...extra]
    .sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || lowest(a) - lowest(b))
    .map((s) => ({ ...s, label: positionLabel(s), rootless: !soundsChroma(s.frets, chroma) }))
    .map((s, _, all) => {
      // Duas formas na mesma posição: numeramos para diferenciar.
      const same = all.filter((o) => o.label === s.label)
      return same.length > 1 ? { ...s, label: `${s.label} ${same.indexOf(s) + 1}` } : s
    })
}

// Quantas casas a janela do diagrama mostra (no mínimo 5).
export function windowSize(shape: Shape | null) {
  if (!shape) return 5
  const pressed = shape.frets.filter((f) => f > 0)
  const top = pressed.length ? Math.max(...pressed) : shape.baseFret
  return Math.max(5, top - shape.baseFret + 1)
}
