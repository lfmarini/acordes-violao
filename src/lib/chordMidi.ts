import * as MidiLib from '@tonejs/midi'
import { estimateKey, identifyChord, spell, sameChord, type SongChord, type SongKey } from './songChords'

// ---------------------------------------------------------------------------
// Leitura do MIDI de acordes (ex.: o baixado do Chordify, versão "time
// aligned"). Não dependemos de um formato exato: juntamos as notas de todas
// as trilhas, cortamos a música em fatias em cada início/fim de nota e
// identificamos o acorde de cada fatia. Fatias iguais seguidas viram um só
// acorde. As batidas vêm da grade do próprio MIDI (uma a cada semínima, ou
// a cada colcheia no 6/8), convertidas para segundos pelo mapa de andamento,
// que no arquivo "time aligned" acompanha a gravação original.
// ---------------------------------------------------------------------------

// O pacote tem duas versões: no navegador o Vite usa a moderna; no Node (testes)
// vem a antiga, que traz tudo dentro de "default".
export const { Midi } = ((MidiLib as { default?: typeof MidiLib }).default ?? MidiLib) as typeof MidiLib

export interface ChordEvent {
  start: number // segundos
  end: number
  chord: SongChord | null // null = sem acorde
}

export interface ChordTrack {
  chords: ChordEvent[]
  beats: number[] // instante de cada batida, em segundos
  beatsPerBar: number
  beatUnit: number // 4 = semínima, 8 = colcheia
  bpm: number
  key: SongKey
  duration: number
  downbeat: number // batida (0..beatsPerBar-1) onde começa o 1º compasso completo
}

/** Fatias mais curtas que isto (s) são "sujeira" de arpejo e se juntam à anterior. */
const MIN_SLICE_S = 0.15

export function readChordMidi(data: ArrayBuffer | Uint8Array): ChordTrack {
  const midi = new Midi(data instanceof Uint8Array ? data : new Uint8Array(data))
  const notes = midi.tracks
    .filter((t) => t.channel !== 9) // canal 10 é bateria
    .flatMap((t) => t.notes)
    .filter((n) => n.duration > 0.02)
  if (!notes.length) throw new Error('Este MIDI não tem notas de acordes.')

  // 1) Fatias entre cada início/fim de nota.
  const cuts = [...new Set(notes.flatMap((n) => [round(n.time), round(n.time + n.duration)]))].sort((a, b) => a - b)
  type Raw = { start: number; end: number; pcs: number[]; bass: number }
  const raw: Raw[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i]
    const b = cuts[i + 1]
    const mid = (a + b) / 2
    const on = notes.filter((n) => n.time <= mid && n.time + n.duration > mid)
    if (!on.length) {
      raw.push({ start: a, end: b, pcs: [], bass: -1 })
      continue
    }
    const low = on.reduce((x, y) => (y.midi < x.midi ? y : x))
    raw.push({ start: a, end: b, pcs: on.map((n) => n.midi % 12), bass: low.midi % 12 })
  }

  // 2) Identifica cada fatia e junta as iguais seguidas.
  const ids = raw.map((r) => ({ ...r, id: r.pcs.length ? identifyChord(r.pcs, r.bass) : null }))
  const key = estimateKey(
    ids.filter((r) => r.id).map((r) => ({ rootPc: r.id!.rootPc, q: r.id!.q, dur: r.end - r.start })),
  )
  let events: ChordEvent[] = []
  for (const r of ids) {
    const chord = r.id ? spell(r.id, key.flats) : null
    const last = events[events.length - 1]
    if (last && sameChord(last.chord, chord) && Math.abs(last.end - r.start) < 0.01) last.end = r.end
    else events.push({ start: r.start, end: r.end, chord })
  }
  // Fatias curtíssimas se juntam à vizinha anterior.
  events = events.reduce<ChordEvent[]>((out, e) => {
    const prev = out[out.length - 1]
    if (prev && e.end - e.start < MIN_SLICE_S) prev.end = e.end
    else if (prev && sameChord(prev.chord, e.chord)) prev.end = e.end
    else out.push({ ...e })
    return out
  }, [])
  // Silêncio no começo não é "acorde".
  while (events.length && !events[0].chord) events.shift()

  // 3) Grade de batidas pelo mapa de andamento do MIDI.
  const ts = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4]
  const beatsPerBar = ts[0] || 4
  const beatUnit = ts[1] || 4
  const ppq = midi.header.ppq
  const beatTicks = (ppq * 4) / beatUnit
  const lastTick = Math.max(...notes.map((n) => n.ticks + n.durationTicks))
  const beats: number[] = []
  for (let tick = 0; tick <= lastTick + beatTicks / 2; tick += beatTicks) beats.push(midi.header.ticksToSeconds(tick))

  // BPM: mediana dos intervalos (o "time aligned" varia um pouco a cada batida).
  const gaps = beats.slice(1).map((b, i) => b - beats[i]).filter((g) => g > 0).sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)] || 0.5
  const bpm = Math.round((60 / median) * 10) / 10

  const duration = Math.max(midi.duration, events[events.length - 1]?.end ?? 0)
  return { chords: events, beats, beatsPerBar, beatUnit, bpm, key, duration, downbeat: findDownbeat(events, beats, beatsPerBar) }
}

/**
 * Em qual batida cai o "1" do compasso: a que recebe mais trocas de acorde
 * (os acordes quase sempre mudam no 1º tempo). Devolve 0..beatsPerBar-1.
 */
export function findDownbeat(events: ChordEvent[], beats: number[], beatsPerBar: number) {
  if (beats.length < 2 || beatsPerBar < 2) return 0
  const votes = new Array(beatsPerBar).fill(0)
  for (const e of events) {
    let i = beats.findIndex((b) => b > e.start)
    if (i < 0) i = beats.length - 1
    if (i > 0 && e.start - beats[i - 1] < beats[i] - e.start) i--
    votes[i % beatsPerBar] += 1
  }
  return votes.indexOf(Math.max(...votes))
}

const round = (t: number) => Math.round(t * 1000) / 1000
