import { Chord, Note } from 'tonal'
import { Midi } from '../src/lib/chordMidi'

// ---------------------------------------------------------------------------
// Música de exemplo para os testes da aba Musik player: acordes em Sol,
// 100 BPM, 4/4, com INTRO, dois versos, refrão três vezes, SOLO e FINAL.
// A letra é inventada (não é de nenhuma música real).
// ---------------------------------------------------------------------------

export const BPM = 100
export const BEAT = 60 / BPM
export const BAR = BEAT * 4

// Cada compasso: acordes (notação internacional para o tonal) e o tempo em que entram.
type Bar = [string, number][]
const b = (...parts: (string | [string, number])[]): Bar => parts.map((p) => (typeof p === 'string' ? [p, 0] : p))

const INTRO = [b('G'), b('Em'), b('C'), b('D')]
const VERSO1 = [b('G'), b('Em'), b('C'), b('D'), b('G'), b('Em'), b('C'), b('D')]
const REFRAO = [b('C'), b('D'), b('G', ['G/B', 2]), b('C'), b('Am7'), b('D7'), b('G'), b('G')]
const VERSO2 = [b('Am7'), b('D7'), b('Gmaj7'), b('F#m7b5', ['B7', 2]), b('Em'), b('C'), b('Am7'), b('D')]
const SOLO = [b('Em'), b('C'), b('G'), b('D'), b('Em'), b('C')]
const FINAL = [b('G'), b('C'), b('G')]

export const BARS: Bar[] = [...INTRO, ...VERSO1, ...REFRAO, ...VERSO2, ...REFRAO, ...SOLO, ...REFRAO, ...FINAL]
// Silêncio antes do 1º compasso (como numa gravação): 2 batidas, para testar
// se o app descobre sozinho onde cai o 1º tempo do compasso.
export const LEAD_IN_S = 2 * BEAT

// Letra inventada: cada linha dura 2 compassos.
const VERSO1_TXT = ['era uma vez uma canção de teste', 'feita só pra conferir o app', 'cada linha cai no seu compasso', 'e o acorde aparece em cima']
const REFRAO_TXT = ['canta comigo esse refrão de mentira', 'bate o pé e segue o tempo', 'o violão responde na hora', 'e a gente volta pro começo']
const VERSO2_TXT = ['a segunda parte muda o caminho', 'com sétima maior e meio diminuto', 'o baixo desce devagarinho', 'até voltar pro lugar de sempre']

function linesAt(firstBar: number, texts: string[]) {
  return texts.map((text, i) => ({ t: LEAD_IN_S + (firstBar + i * 2) * BAR + 0.05, text }))
}

export function lyricsLrc() {
  const start = { v1: 4, r1: 12, v2: 20, r2: 28, r3: 42 }
  const all = [
    ...linesAt(start.v1, VERSO1_TXT),
    { t: LEAD_IN_S + 12 * BAR - 0.3, text: '' },
    ...linesAt(start.r1, REFRAO_TXT),
    { t: LEAD_IN_S + 20 * BAR - 0.3, text: '' },
    ...linesAt(start.v2, VERSO2_TXT),
    { t: LEAD_IN_S + 28 * BAR - 0.3, text: '' },
    ...linesAt(start.r2, REFRAO_TXT),
    ...linesAt(start.r3, REFRAO_TXT),
  ]
  const stamp = (t: number) => `[${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}]`
  return all.map((l) => `${stamp(l.t)} ${l.text}`.trimEnd()).join('\n')
}

export const TOTAL_S = LEAD_IN_S + BARS.length * BAR

/** MIDI de acordes parecido com o do Chordify: acordes em bloco, com baixo. */
export function chordMidi(): Uint8Array {
  const midi = new Midi()
  midi.header.setTempo(BPM)
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] })
  midi.header.update()
  const track = midi.addTrack()
  const events: { name: string; start: number; end: number }[] = []
  BARS.forEach((bar, i) => {
    bar.forEach(([name, beat], k) => {
      const start = LEAD_IN_S + i * BAR + beat * BEAT
      const nextBeat = bar[k + 1]?.[1] ?? 4
      events.push({ name, start, end: LEAD_IN_S + i * BAR + nextBeat * BEAT })
    })
  })
  for (const e of events) {
    const [main, bass] = e.name.split('/')
    const notes = Chord.get(main).notes
    const root = Note.midi(notes[0] + '3')!
    const bassMidi = Note.midi((bass ?? notes[0]) + '2')!
    track.addNote({ midi: bassMidi, time: e.start, duration: e.end - e.start - 0.01 })
    for (const n of notes) {
      let m = Note.midi(n + '4')!
      while (m - root >= 12) m -= 12
      while (m < root) m += 12
      track.addNote({ midi: m + 12, time: e.start, duration: e.end - e.start - 0.01 })
    }
  }
  return midi.toArray()
}
