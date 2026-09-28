import { Key, Note } from 'tonal'
import { QUALITIES, qualityOfSemitones, shapesFor, type ChordRef, type Shape } from './chords'
import { parseChord } from './parser'
import { rankChords } from './recognize'
import { chromaAt } from './theory'

// ---------------------------------------------------------------------------
// Acordes de uma música (aba Musik player).
//
// Diferente do ChordRef da aba Acordes, aqui o acorde pode ter baixo trocado
// (G/B) e é guardado de forma simples, para caber no JSON salvo no aparelho.
// A grafia da tônica (F# ou Gb) é escolhida pelo tom da música.
// ---------------------------------------------------------------------------

export interface SongChord {
  root: string // grafia da tônica (ex.: "F#")
  q: string // id da qualidade (ver QUALITIES em chords.ts)
  bass?: string // baixo, quando é diferente da tônica (ex.: "B" em G/B)
}

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

export const pcName = (pc: number, flats: boolean) => (flats ? FLATS : SHARPS)[((pc % 12) + 12) % 12]

export const qualityOf = (c: SongChord) => QUALITIES.find((q) => q.id === c.q) ?? QUALITIES[0]

/** Nome na notação brasileira: C7M, Am7, G/B, F#m7(b5). */
export function songChordName(c: SongChord | null | undefined) {
  if (!c) return '—'
  return c.root + qualityOf(c).br + (c.bass ? `/${c.bass}` : '')
}

export const sameChord = (a: SongChord | null | undefined, b: SongChord | null | undefined) =>
  songChordName(a) === songChordName(b)

export const toChordRef = (c: SongChord): ChordRef => ({ root: c.root, quality: qualityOf(c) })

/** Acorde brasileiro/internacional digitado, aceitando baixo trocado ("G/B"). */
export function parseSongChord(text: string): SongChord | null {
  const [main, bass] = text.trim().split('/')
  const r = parseChord(main ?? '')
  if (!r.ok) return null
  const b = bass ? Note.pitchClass(bass.trim().replace(/^([a-g])/, (m) => m.toUpperCase())) : ''
  return { root: r.chord.root, q: r.chord.quality.id, ...(b && Note.chroma(b) !== Note.chroma(r.chord.root) ? { bass: b } : {}) }
}

/**
 * Descobre o acorde a partir das classes de notas que soam juntas
 * (0 = C ... 11 = B) e da nota mais grave. Primeiro tentamos uma
 * correspondência exata com as qualidades do app; se não houver, usamos o
 * mesmo "molde" do reconhecedor por microfone (rankChords).
 */
export function identifyChord(pcs: number[], bassPc: number): { rootPc: number; q: string; bassPc: number } | null {
  const set = [...new Set(pcs.map((p) => ((p % 12) + 12) % 12))]
  if (set.length === 0) return null
  if (set.length === 1) return { rootPc: set[0], q: 'maior', bassPc: set[0] } // nota solta: tratamos como o acorde maior
  if (set.length === 2) {
    // Quinta sem terça (power chord) ou intervalo: fica o acorde maior do baixo.
    const other = set.find((p) => p !== bassPc) ?? set[0]
    const iv = (other - bassPc + 12) % 12
    if (iv === 7) return { rootPc: bassPc, q: 'maior', bassPc }
    if (iv === 3) return { rootPc: bassPc, q: 'menor', bassPc }
    if (iv === 4) return { rootPc: bassPc, q: 'maior', bassPc }
  }
  // Candidatos a tônica: o baixo primeiro (o mais comum), depois as outras notas.
  const roots = [bassPc, ...set.filter((p) => p !== bassPc)]
  for (const root of roots) {
    const q = qualityOfSemitones(set.map((p) => p - root))
    if (q) return { rootPc: root, q: q.id, bassPc }
  }
  // Sem as notas do baixo (acorde com baixo que não pertence a ele: C/D etc.).
  const upper = set.filter((p) => p !== bassPc)
  for (const root of upper) {
    const q = qualityOfSemitones(upper.map((p) => p - root))
    if (q) return { rootPc: root, q: q.id, bassPc }
  }
  const chroma = Array.from({ length: 12 }, (_, i) => (set.includes(i) ? 1 : 0))
  const bass = Array.from({ length: 12 }, (_, i) => (i === bassPc ? 1 : 0))
  const best = rankChords(chroma, bass, 1)[0]
  if (!best) return null
  return { rootPc: Note.chroma(best.chord.root) ?? 0, q: best.chord.quality.id, bassPc }
}

// --- Tom da música ---------------------------------------------------------

export interface SongKey {
  tonic: string // "G", "Bb"...
  minor: boolean
  flats: boolean // usar bemóis na grafia
  name: string // "G", "Em"
}

const TRIAD_KIND: Record<string, 'M' | 'm' | 'd'> = { maior: 'M', '7': 'M', '7M': 'M', '6': 'M', '9': 'M', add9: 'M', '7M9': 'M', '13': 'M', menor: 'm', m7: 'm', m6: 'm', m9: 'm', m7M: 'm', dim: 'd', m7b5: 'd', dim7: 'd' }

/**
 * Estima o tom pelos acordes (pesados pelo tempo que cada um soa): o tom cujo
 * campo harmônico explica mais tempo de música vence. Empate: o primeiro e o
 * último acorde da música costumam ser a tônica.
 */
export function estimateKey(events: { rootPc: number; q: string; dur: number }[]): SongKey {
  if (!events.length) return { tonic: 'C', minor: false, flats: false, name: 'C' }
  let best = { score: -Infinity, tonic: 'C', minor: false, alteration: 0 }
  for (let pc = 0; pc < 12; pc++) {
    for (const minor of [false, true]) {
      const tonic = pcName(pc, false)
      const k = minor ? Key.minorKey(tonic).natural : Key.majorKey(tonic)
      const alteration = minor ? Key.minorKey(tonic).alteration : Key.majorKey(tonic).alteration
      const diatonic = k.triads.map((t) => {
        const m = t.match(/^([A-G][#b]*)(.*)$/)!
        return { pc: Note.chroma(m[1]) ?? 0, kind: m[2] === 'm' ? 'm' : m[2] === 'dim' ? 'd' : 'M' }
      })
      // A dominante maior da menor harmônica também "pertence" ao tom menor.
      if (minor) diatonic.push({ pc: (pc + 7) % 12, kind: 'M' })
      let score = 0
      for (const e of events) {
        const kind = TRIAD_KIND[e.q] ?? 'M'
        if (diatonic.some((d) => d.pc === e.rootPc && d.kind === kind)) score += e.dur
        else score -= e.dur * 0.5
      }
      const tonicKind = minor ? 'm' : 'M'
      const isTonic = (e: (typeof events)[number]) => e.rootPc === pc && (TRIAD_KIND[e.q] ?? 'M') === tonicKind
      if (isTonic(events[0])) score += 4
      if (isTonic(events[events.length - 1])) score += 4
      // Menos acidentes na armadura desempata (tons mais comuns no violão).
      score -= Math.abs(alteration) * 0.01
      if (score > best.score) best = { score, tonic, minor, alteration }
    }
  }
  const flats = best.alteration < 0
  const tonic = pcName(Note.chroma(best.tonic) ?? 0, flats)
  return { tonic, minor: best.minor, flats, name: tonic + (best.minor ? 'm' : '') }
}

/** Converte o acorde identificado para a grafia do tom (bemóis ou sustenidos). */
export function spell(id: { rootPc: number; q: string; bassPc: number }, flats: boolean): SongChord {
  const root = pcName(id.rootPc, flats)
  return id.bassPc === id.rootPc ? { root, q: id.q } : { root, q: id.q, bass: pcName(id.bassPc, flats) }
}

/**
 * Forma para desenhar/tocar o acorde. No acorde com baixo trocado (G/B),
 * preferimos a forma do acorde cuja corda mais grave já toca o baixo pedido.
 */
export function shapeForSongChord(c: SongChord): Shape | null {
  const shapes = shapesFor(toChordRef(c))
  if (!c.bass) return shapes[0] ?? null
  const want = Note.chroma(c.bass)
  const lowest = (s: Shape) => {
    const i = s.frets.findIndex((f) => f >= 0)
    return i < 0 ? -1 : chromaAt(i, s.frets[i])
  }
  return shapes.find((s) => lowest(s) === want) ?? shapes[0] ?? null
}
