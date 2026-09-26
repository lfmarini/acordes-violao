import { Note } from 'tonal'
import * as Tone from 'tone'
import type { Shape } from './chords'
import { noteAt } from './theory'

// ---------------------------------------------------------------------------
// Som do acorde, sintetizado na hora com o tone.js (nada é baixado, então
// funciona offline). Usamos o PluckSynth, que simula uma corda dedilhada
// (algoritmo Karplus-Strong). Cada corda do violão tem o seu próprio
// sintetizador, como no instrumento de verdade: as notas continuam soando
// juntas depois de atacadas.
// ---------------------------------------------------------------------------

/** Atraso entre uma corda e a próxima no ataque, em milissegundos. Ajuste à vontade (25 a 40 soa natural). */
export const STRUM_DELAY_MS = 32
/** Duração total do acorde, em segundos. */
export const CHORD_DURATION_S = 2
/** Duração do decaimento suave no final, em segundos. */
export const FADE_OUT_S = 0.6

let volume: Tone.Volume | null = null
let bus: Tone.Gain | null = null
let strings: Tone.PluckSynth[] = []
let timers: number[] = []

function setup() {
  if (volume) return
  volume = new Tone.Volume(0).toDestination()
  bus = new Tone.Gain(0).connect(volume)
  // Um leve reverb de sala deixa o som menos "seco".
  const room = new Tone.Freeverb({ roomSize: 0.55, dampening: 3200, wet: 0.18 }).connect(bus)
  strings = Array.from({ length: 6 }, () =>
    new Tone.PluckSynth({ attackNoise: 1.2, dampening: 3600, resonance: 0.985, release: 0.05 }).connect(room),
  )
}

export function setVolume(level: number, muted: boolean) {
  if (!volume) return
  volume.mute = muted
  volume.volume.value = Tone.gainToDb(Math.max(level, 0.0001))
}

/**
 * Toca o acorde da 6ª corda para a 1ª, pulando as cordas com X.
 * `onPluck` é chamado no instante em que cada corda é atacada (para o brilho no diagrama).
 * Deve ser chamado dentro do clique: o navegador só libera o áudio após interação.
 */
export function playShape(shape: Shape, level: number, muted: boolean, onPluck: (stringIndex: number) => void) {
  void Tone.start() // libera o áudio (precisa estar dentro do clique)
  setup()
  setVolume(level, muted)

  // Se ainda estava tocando: corta o som anterior rapidinho e recomeça.
  timers.forEach(clearTimeout)
  timers = []
  const gain = bus!.gain
  const now = Tone.now()
  gain.cancelScheduledValues(now)
  gain.setValueAtTime(gain.value, now)
  gain.linearRampToValueAtTime(0, now + 0.03)
  strings.forEach((str) => str.triggerRelease(now + 0.03)) // abafa todas as cordas

  const start = now + 0.05
  gain.setValueAtTime(1, start)

  let k = 0
  shape.frets.forEach((fret, s) => {
    if (fret < 0) return // corda com X: não toca
    // Altura REAL da corda: afinação da corda solta + casa (via tonal).
    const midi = Note.midi(noteAt(s, fret))
    if (midi === null) return
    const when = start + (k++ * STRUM_DELAY_MS) / 1000
    strings[s].triggerAttack(Tone.Frequency(midi, 'midi').toFrequency(), when)
    timers.push(window.setTimeout(() => onPluck(s), (when - Tone.now()) * 1000))
  })

  // Decaimento suave até o fim dos 2 segundos, sem corte seco.
  const end = start + CHORD_DURATION_S
  gain.setValueAtTime(1, end - FADE_OUT_S)
  gain.exponentialRampToValueAtTime(0.0001, end)
  gain.setValueAtTime(0, end + 0.01)
  strings.forEach((str) => str.triggerRelease(end))
}
