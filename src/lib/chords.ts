import guitar from '@tombatossals/chords-db/lib/guitar.json'
import { Chord, Interval, Note } from 'tonal'
import { FIXES, shapeKey } from './chordFixes'

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
  /** Nota mais grave que soa, com a grafia do acorde (ex.: "E"). */
  bass?: string
  /** 0 = tônica no baixo; 1 = terça (1ª inversão); 2 = quinta (2ª); 3 = sétima (3ª); -1 = outra nota. */
  inversion?: number
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

// ---------------------------------------------------------------------------
// Filtro por tipo de acorde:
//  - tríades: 3 notas (maior, menor, diminuto, aumentado e os suspensos);
//  - tétrades: tríade + sétima (7, 7M, m7, m7M, °7, m7(b5), 7sus4);
//  - outros: sextas, nonas, 13 e alterados (acordes com notas acrescentadas);
//  - inversões: tríades e tétrades com outra nota do acorde no baixo.
// ---------------------------------------------------------------------------
export type ChordFilter = 'todos' | 'triades' | 'tetrades' | 'inversoes' | 'outros'

export const FILTERS: { id: ChordFilter; label: string; hint: string }[] = [
  { id: 'todos', label: 'Todos', hint: 'todos os acordes' },
  { id: 'triades', label: 'Tríades', hint: '3 notas: tônica, terça e quinta' },
  { id: 'tetrades', label: 'Tétrades', hint: 'tríade + sétima' },
  { id: 'inversoes', label: 'Inversões', hint: 'outra nota do acorde no baixo' },
  { id: 'outros', label: 'Outros', hint: 'sextas, nonas, 13 e alterados' },
]

const CATEGORY: Record<Quality['id'], 'triades' | 'tetrades' | 'outros'> = {
  maior: 'triades', menor: 'triades', dim: 'triades', aug: 'triades', sus2: 'triades', sus4: 'triades',
  '7': 'tetrades', '7M': 'tetrades', m7: 'tetrades', m7M: 'tetrades', dim7: 'tetrades', m7b5: 'tetrades', '7sus4': 'tetrades',
  '6': 'outros', m6: 'outros', '9': 'outros', add9: 'outros', m9: 'outros', '7M9': 'outros', '7b9': 'outros', '7#9': 'outros', '13': 'outros',
}

/** As qualidades que aparecem na lista com o filtro escolhido. */
export function qualitiesFor(filter: ChordFilter): readonly Quality[] {
  if (filter === 'todos') return QUALITIES
  if (filter === 'inversoes') return QUALITIES.filter((q) => CATEGORY[q.id] !== 'outros')
  return QUALITIES.filter((q) => CATEGORY[q.id] === filter)
}

export const INVERSION_NAMES = ['posição fundamental', '1ª inversão', '2ª inversão', '3ª inversão']

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

// Forma ajustada (ver chordFixes.ts) -> mesmo formato das formas do banco.
// A pestana sai da digitação: um dedo em 2+ cordas na mesma casa.
function fromFix(frets: number[], fingers: number[]): Omit<Shape, 'label'> {
  const pressed = frets.filter((f) => f > 0)
  const baseFret = !pressed.length || Math.max(...pressed) <= 5 ? 1 : Math.min(...pressed)
  const barres: Barre[] = []
  for (const finger of new Set(fingers.filter((d) => d > 0))) {
    const on = frets.flatMap((f, s) => (fingers[s] === finger && f > 0 ? [s] : []))
    if (on.length > 1 && new Set(on.map((s) => frets[s])).size === 1)
      barres.push({ fret: frets[on[0]], from: Math.min(...on), to: Math.max(...on), finger })
  }
  const isOpen = baseFret === 1 && frets.some((f) => f === 0)
  return { frets: [...frets], fingers: [...fingers], barres, baseFret, isOpen }
}

// Sugestão de digitação para formas sem essa informação: a casa mais baixa
// recebe o dedo mais baixo, a mais alta o mais alto. Só sugerimos quando cabe
// em 4 dedos sem pestana; caso contrário, os círculos ficam sem número
// (melhor não mostrar do que ensinar uma digitação errada).
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

// Nota mais grave da forma e qual grau do acorde ela é (inversão).
function bassInfo(frets: number[], ref: ChordRef): { bass?: string; inversion?: number } {
  const s = frets.findIndex((f) => f >= 0)
  if (s < 0) return {}
  const chroma = (Note.midi(OPEN_STRINGS[s])! + frets[s]) % 12
  const chord = Chord.get(chordTonalName(ref))
  const k = chord.notes.findIndex((n) => Note.chroma(n) === chroma)
  if (k < 0) return { bass: Note.pitchClass(Note.fromMidi(chroma + 60)), inversion: -1 }
  const num = Interval.get(chord.intervals[k]).num ?? 0
  const inversion = ({ 1: 0, 3: 1, 5: 2, 7: 3 } as Record<number, number>)[num] ?? -1
  return { bass: chord.notes[k], inversion }
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
// Formas do banco (já com os ajustes de notas erradas), como vieram:
// algumas têm outra nota do acorde no baixo (são inversões).
export function bankShapes(ref: ChordRef): Shape[] {
  const chroma = Note.chroma(ref.root)
  if (chroma === undefined) return []
  const entry = db.chords[DB_KEYS[chroma]]?.find((c) => c.suffix === ref.quality.db)
  if (!entry) return []
  // Formas com notas erradas no banco são trocadas pela versão ajustada
  // (ver chordFixes.ts); nenhuma forma é removida.
  const key = DB_KEYS[chroma]
  const shapes = entry.positions.map((p) => {
    const s = toShape(p)
    const fix = FIXES[shapeKey(key, entry.suffix, s.frets)]
    return fix ? fromFix(fix.frets, fix.fingers) : s
  })
  return finish(shapes.map((s) => fixBarres(s, ref)), ref, chroma)
}

// Ordena (aberta primeiro, depois da casa mais baixa), dá o rótulo e marca
// baixo/inversão de cada forma.
function finish(shapes: Omit<Shape, 'label'>[], ref: ChordRef, chroma: number): Shape[] {
  const lowest = (s: Omit<Shape, 'label'>) => {
    const pressed = s.frets.filter((f) => f > 0)
    return pressed.length ? Math.min(...pressed) : 0
  }
  return shapes
    .sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || lowest(a) - lowest(b))
    .map((s) => ({ ...s, label: positionLabel(s), rootless: !soundsChroma(s.frets, chroma), ...bassInfo(s.frets, ref) }))
    .map((s, _, all) => {
      // Duas formas na mesma posição: numeramos para diferenciar.
      const same = all.filter((o) => o.label === s.label)
      return same.length > 1 ? { ...s, label: `${s.label} ${same.indexOf(s) + 1}` } : s
    })
}

// Pestana que passa por uma corda abafada ou solta é impossível de tocar
// (a pestana faria essa corda soar). Ajuste, nesta ordem:
//  1. se a nota da pestana nessa corda é do acorde, a corda passa a soar;
//  2. senão, a pestana sai: a corda mais grave dela continua presa, as outras
//     que ela prendia continuam só se tiverem nota essencial que não aparece
//     em outra corda, e os dedos são redistribuídos — desde que bastem 4.
function fixBarres(s: Omit<Shape, 'label'>, ref: ChordRef): Omit<Shape, 'label'> {
  const tones = new Set(Chord.get(chordTonalName(ref)).notes.map((n) => Note.chroma(n)))
  const sound = (i: number, f: number) => (Note.midi(OPEN_STRINGS[i])! + f) % 12
  let frets = [...s.frets]
  let fingers = [...s.fingers]
  const barres: Barre[] = []
  for (const b of s.barres) {
    const holes = []
    for (let i = b.from; i <= b.to; i++) if (frets[i] < b.fret) holes.push(i)
    if (!holes.length) {
      barres.push(b)
      continue
    }
    // 1. A corda passa a soar na casa da pestana, se a nota for do acorde.
    if (holes.every((i) => tones.has(sound(i, b.fret)))) {
      for (const i of holes) {
        frets[i] = b.fret
        fingers[i] = b.finger
      }
      barres.push(b)
      continue
    }
    // 2. Sem pestana: o dedo fica só na corda mais grave dela.
    const held = frets.flatMap((f, i) => (i >= b.from && i <= b.to && f === b.fret && fingers[i] === b.finger ? [i] : []))
    const essential = new Set(essentialChromas(ref))
    const tryFrets = [...frets]
    for (const i of held.slice(1)) {
      const note = sound(i, b.fret)
      const elsewhere = tryFrets.some((f, k) => k !== i && f >= 0 && sound(k, f) === note)
      if (!essential.has(note) || elsewhere) tryFrets[i] = -1
    }
    const heard = new Set(tryFrets.flatMap((f, i) => (f >= 0 ? [sound(i, f)] : [])))
    const pressed = tryFrets.filter((f) => f > 0).length
    if ([...essential].every((c) => heard.has(c)) && pressed <= 4 && tryFrets.filter((f) => f >= 0).length >= 3) {
      frets = tryFrets
      fingers = suggestFingers(tryFrets)
    } else barres.push(b) // não deu para ajustar: fica como está (o verificador aponta)
  }
  return { ...s, frets, fingers, barres }
}

// Notas que o acorde não pode perder: todas, menos a quinta justa (e, no 13,
// a 9ª e a 11ª), que no violão costumam ficar de fora.
function essentialChromas(ref: ChordRef) {
  const chord = Chord.get(chordTonalName(ref))
  return chord.intervals
    .filter((iv) => iv !== '5P' && iv !== '11P' && !(ref.quality.id === '13' && iv === '9M'))
    .map((iv) => Note.chroma(Note.transpose(ref.root, iv))!)
}

// Inversão -> posição fundamental na mesma região: deixa de tocar as cordas
// graves até a mais grave que soa ser a tônica. Só vale se sobrarem ao menos
// 3 cordas e nenhuma nota essencial do acorde se perder.
function toRootPosition(s: Shape, ref: ChordRef): Omit<Shape, 'label'> | null {
  const root = Note.chroma(ref.root)!
  const sound = (i: number) => (Note.midi(OPEN_STRINGS[i])! + s.frets[i]) % 12
  const first = s.frets.findIndex((f, i) => f >= 0 && sound(i) === root)
  if (first < 0) return null
  const frets = s.frets.map((f, i) => (i < first ? -1 : f))
  const heard = new Set(frets.flatMap((f, i) => (f >= 0 ? [sound(i)] : [])))
  if (frets.filter((f) => f >= 0).length < 3 || !essentialChromas(ref).every((c) => heard.has(c))) return null
  const fingers = s.fingers.map((d, i) => (i < first ? 0 : d))
  // Pestanas: só sobre as cordas que continuam tocando.
  const barres = s.barres.flatMap((b) => {
    const on = frets.flatMap((f, i) => (i >= b.from && i <= b.to && f === b.fret && fingers[i] === b.finger ? [i] : []))
    return on.length > 1 ? [{ ...b, from: Math.min(...on), to: Math.max(...on) }] : []
  })
  const pressed = frets.filter((f) => f > 0)
  const isOpen = s.baseFret === 1 && frets.some((f) => f === 0)
  return { frets, fingers, barres, baseFret: pressed.length ? s.baseFret : 1, isOpen }
}

/**
 * Formas do acorde para a lista normal: na posição fundamental (tônica no
 * baixo). As formas do banco que eram inversões são ajustadas na mesma região
 * (as cordas graves abaixo da tônica deixam de ser tocadas). Se isso tirar
 * alguma nota essencial, a forma continua como inversão, com o aviso.
 * As inversões originais ficam no filtro "Inversões".
 */
export function shapesFor(ref: ChordRef): Shape[] {
  const chroma = Note.chroma(ref.root)
  if (chroma === undefined) return []
  const bank = bankShapes(ref)
  const seen = new Set(bank.filter((s) => (s.inversion ?? 0) <= 0).map((s) => s.frets.join()))
  const out = bank.map((s) => {
    if ((s.inversion ?? 0) <= 0) return s
    const adj = toRootPosition(s, ref)
    // Se o ajuste ficar igual a outra forma do acorde, mantemos a inversão
    // (com o aviso) para não perder nenhuma forma.
    if (!adj || seen.has(adj.frets.join())) return s
    seen.add(adj.frets.join())
    return adj
  })
  return finish(out, ref, chroma)
}

// Inversões de um acorde: as formas do banco com outra nota do acorde no
// baixo, mais as formas "com barra" do banco (C/E, Am/C...) quando o baixo é
// nota do acorde. Da mais grave para a mais aguda.
export function inversionShapesFor(ref: ChordRef): Shape[] {
  const chroma = Note.chroma(ref.root)
  if (chroma === undefined) return []
  const own = bankShapes(ref).filter((s) => (s.inversion ?? 0) > 0)
  const prefix = ref.quality.id === 'maior' ? '/' : ref.quality.id === 'menor' ? 'm/' : null
  const slash = prefix
    ? (db.chords[DB_KEYS[chroma]] ?? [])
        .filter((c) => c.suffix.startsWith(prefix) && (prefix === 'm/' || !c.suffix.startsWith('m/')))
        .flatMap((c) =>
          c.positions.map((pos) => {
            const sh = toShape(pos)
            const fix = FIXES[shapeKey(DB_KEYS[chroma], c.suffix, sh.frets)]
            return fix ? fromFix(fix.frets, fix.fingers) : sh
          }),
        )
        .map((s) => ({ ...s, label: positionLabel(s), rootless: false, ...bassInfo(s.frets, ref) }))
        .filter((s) => (s.inversion ?? 0) > 0)
    : []
  const seen = new Set<string>()
  const lowest = (s: Shape) => Math.min(...s.frets.filter((f) => f > 0), 99)
  return [...own, ...slash]
    .filter((s) => !seen.has(s.frets.join(',')) && seen.add(s.frets.join(',')))
    .sort((a, b) => (a.inversion ?? 0) - (b.inversion ?? 0) || Number(b.isOpen) - Number(a.isOpen) || lowest(a) - lowest(b))
    .map((s) => ({ ...s, label: s.label.replace(/ \d+$/, '') }))
    .map((s, _, all) => {
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
