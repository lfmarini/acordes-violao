import { Note } from 'tonal'
import { chordDisplayName, type ChordRef } from './chords'
import { PC_NAMES, rankChords, type Frame } from './recognize'

// ---------------------------------------------------------------------------
// Identificação ao vivo: com o microfone ligado, diz qual nota ou acorde está
// soando. Usa a mesma análise do "Capturar acorde", mas de forma contínua:
// as notas ouvidas vão se acumulando e "esquecendo" aos poucos (meia-vida de
// ~0,5 s), assim o resultado acompanha as trocas de acorde sem piscar.
//  - 1 nota soando  → mostra a nota com a oitava, a frequência e se está
//                      afinada (em cents; 100 cents = 1 semitom);
//  - 2 notas        → mostra as duas;
//  - 3 ou mais      → procura o acorde mais parecido.
// ---------------------------------------------------------------------------

/** Abaixo deste volume (dBFS) consideramos silêncio. */
export const LIVE_GATE_DB = -48
/** Quanto tempo (s) o som "fica na memória" da análise. */
const MEMORY_S = 0.7
/** Uma nota conta se tiver ao menos esta fração da força da mais forte. */
const PRESENT = 0.4
/** Confiança mínima para afirmar um acorde. */
const CHORD_MIN = 0.35

export type LiveResult =
  | { kind: 'silence' }
  | { kind: 'note'; note: string; hz: number; cents: number }
  | { kind: 'notes'; notes: string[] }
  | { kind: 'chord'; chord: ChordRef; score: number; notes: string[] }

export function liveLabel(r: LiveResult) {
  if (r.kind === 'note') return r.note
  if (r.kind === 'chord') return chordDisplayName(r.chord)
  if (r.kind === 'notes') return r.notes.join('+')
  return ''
}

export class LiveDetector {
  private chroma = new Array(12).fill(0)
  private bass = new Array(12).fill(0)
  private quietFor = 0
  private shown: LiveResult = { kind: 'silence' }
  private candidate = ''
  private repeats = 0

  update(frame: Frame, db: number, dt: number): LiveResult {
    if (db < LIVE_GATE_DB) {
      this.quietFor += dt
      if (this.quietFor > 0.4) {
        this.chroma.fill(0)
        this.bass.fill(0)
        this.shown = { kind: 'silence' }
      }
      return this.shown
    }
    this.quietFor = 0
    const keep = Math.exp(-dt / MEMORY_S)
    for (let i = 0; i < 12; i++) {
      this.chroma[i] = this.chroma[i] * keep + frame.chroma[i]
      this.bass[i] = this.bass[i] * keep + frame.bass[i]
    }
    const next = this.classify(frame)
    // Só troca o que aparece na tela quando o novo resultado se repete,
    // para não ficar piscando entre dois palpites.
    const label = next.kind + liveLabel(next)
    if (label === this.candidate) this.repeats++
    else {
      this.candidate = label
      this.repeats = 1
    }
    const sameShown = this.shown.kind + liveLabel(this.shown) === label
    if (this.repeats >= 2 || sameShown) this.shown = next
    return this.shown
  }

  private classify(frame: Frame): LiveResult {
    const top = Math.max(...this.chroma)
    if (top <= 0) return { kind: 'silence' }
    const present = this.chroma.map((v, pc) => ({ v: v / top, pc })).filter((x) => x.v >= PRESENT)
    if (present.length === 1) {
      const pc = present[0].pc
      // Frequência: a fundamental mais forte desta nota no quadro atual.
      const f = frame.fundamentals
        .filter((n) => ((Math.round(69 + 12 * Math.log2(n.f / 440)) % 12) + 12) % 12 === pc)
        .sort((a, b) => b.strength - a.strength)[0]?.f
      if (!f) return { kind: 'notes', notes: [PC_NAMES[pc]] }
      const midi = 69 + 12 * Math.log2(f / 440)
      const near = Math.round(midi)
      return { kind: 'note', note: Note.fromMidiSharps(near), hz: f, cents: Math.round((midi - near) * 100) }
    }
    if (present.length === 2) {
      return { kind: 'notes', notes: present.sort((a, b) => b.v - a.v).map((x) => PC_NAMES[x.pc]) }
    }
    const [best] = rankChords(this.chroma, this.bass, 1)
    if (best && best.score >= CHORD_MIN) return { kind: 'chord', chord: best.chord, score: best.score, notes: best.notes }
    return { kind: 'notes', notes: present.sort((a, b) => b.v - a.v).map((x) => PC_NAMES[x.pc]) }
  }
}
