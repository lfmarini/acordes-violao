import { Note } from 'tonal'
import * as Tone from 'tone'
import type { Shape } from './chords'
import { synthPluck } from './ks'
import { readStored } from './storage'
import { noteAt } from './theory'

// ---------------------------------------------------------------------------
// Som do acorde. Cada nota é sintetizada na hora por um modelo de corda
// (ver ks.ts) e depois passa por filtros que imitam o corpo de madeira do
// violão. Nada é baixado, então funciona offline.
//
// Afinação: A4 = 440 Hz, e cada casa sobe 1 semitom. As cordas soltas são
// E2 (82,41 Hz), A2 (110 Hz), D3 (146,83 Hz), G3 (196 Hz), B3 (246,94 Hz)
// e E4 (329,63 Hz). A nota de cada corda vem do tonal (corda solta + casa).
// ---------------------------------------------------------------------------

/** Atraso padrão entre uma corda e a próxima no ataque, em ms (valor do meio do cursor). */
export const STRUM_DELAY_MS = 32
/** Limites do cursor de velocidade: mais rápido e mais lento, em ms. */
export const STRUM_MIN_MS = 10
export const STRUM_MAX_MS = 100
/** Duração total do acorde, em segundos. */
export const CHORD_DURATION_S = 2
/** Duração do decaimento suave no final, em segundos. */
export const FADE_OUT_S = 0.6
/** Referência de afinação. */
export const A4_HZ = 440

export const hzOf = (note: string) => A4_HZ * Math.pow(2, ((Note.midi(note) ?? 69) - 69) / 12)

let volume: Tone.Volume | null = null
let bus: Tone.Gain | null = null
let body: Tone.Gain | null = null
let voices: (Tone.ToneBufferSource | null)[] = [null, null, null, null, null, null]
let timers: number[] = []
const cache = new Map<string, Tone.ToneAudioBuffer>()

// Corpo do violão: ressonância grave da caixa (~100 Hz), "calor" (~220 Hz),
// presença (~3 kHz) e corte dos agudos ásperos. Um reverb curto de sala.
// Devolve a entrada da cadeia (onde as cordas são ligadas).
function makeBody(out: Tone.InputNode) {
  const room = new Tone.Freeverb({ roomSize: 0.5, dampening: 3000, wet: 0.14 }).connect(out)
  const air = new Tone.Filter({ type: 'lowpass', frequency: 7000, Q: 0.5 }).connect(room)
  const presence = new Tone.Filter({ type: 'peaking', frequency: 3000, Q: 0.9, gain: 2 }).connect(air)
  const warmth = new Tone.Filter({ type: 'peaking', frequency: 220, Q: 1.4, gain: 2.5 }).connect(presence)
  const box = new Tone.Filter({ type: 'peaking', frequency: 105, Q: 1.8, gain: 4 }).connect(warmth)
  const rumble = new Tone.Filter({ type: 'highpass', frequency: 70, Q: 0.7 }).connect(box)
  return new Tone.Gain(0.32).connect(rumble)
}

function setup() {
  if (volume) return
  volume = new Tone.Volume(0).toDestination()
  bus = new Tone.Gain(0).connect(volume)
  body = makeBody(bus)
}

// Gera (uma vez) e guarda o som de cada nota em cada corda.
function bufferFor(stringIndex: number, note: string, fret: number) {
  const key = `${stringIndex}-${note}`
  let buf = cache.get(key)
  if (!buf) {
    const data = synthPluck({
      freq: hzOf(note),
      sampleRate: Tone.getContext().sampleRate,
      duration: CHORD_DURATION_S + 0.3,
      // Cordas graves soam mais tempo; casas altas abafam um pouco.
      t60: 4.2 - stringIndex * 0.35 - fret * 0.04,
      brightness: 0.4 + stringIndex * 0.03,
      seed: stringIndex * 31 + fret + 7,
    })
    buf = Tone.ToneAudioBuffer.fromArray(data)
    cache.set(key, buf)
  }
  return buf
}

export function setVolume(level: number, muted: boolean) {
  if (!volume) return
  volume.mute = muted
  volume.volume.value = Tone.gainToDb(Math.max(level, 0.0001))
}

/**
 * Toca o acorde da 6ª corda para a 1ª, pulando as cordas com X.
 * `strumMs` é o atraso entre uma corda e a próxima (velocidade do ataque).
 * `onPluck` é chamado no instante em que cada corda é atacada (para o brilho no diagrama).
 * Deve ser chamado dentro do clique: o navegador só libera o áudio após interação.
 */
export function playShape(
  shape: Shape,
  level: number,
  muted: boolean,
  strumMs: number,
  onPluck: (stringIndex: number) => void,
) {
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
  voices.forEach((v) => v?.stop(now + 0.04))
  voices = [null, null, null, null, null, null]

  const start = now + 0.06
  gain.setValueAtTime(1, start)

  let k = 0
  shape.frets.forEach((fret, s) => {
    if (fret < 0) return // corda com X: não toca
    // Altura REAL da corda: afinação da corda solta + casa (via tonal).
    const note = noteAt(s, fret)
    const when = start + (k++ * strumMs) / 1000
    const src = new Tone.ToneBufferSource(bufferFor(s, note, fret)).connect(body!)
    // Pequena variação de força entre as cordas, como na mão de verdade.
    src.start(when, 0, undefined, 0.85 + Math.random() * 0.15)
    voices[s] = src
    timers.push(window.setTimeout(() => onPluck(s), Math.max(0, (when - Tone.now()) * 1000)))
  })

  // Decaimento suave até o fim dos 2 segundos, sem corte seco.
  const end = start + CHORD_DURATION_S
  gain.setValueAtTime(1, end - FADE_OUT_S)
  gain.exponentialRampToValueAtTime(0.0001, end)
  gain.setValueAtTime(0, end + 0.01)
  voices.forEach((v) => v?.stop(end + 0.05))
}

// ---------------------------------------------------------------------------
// Acompanhamento do Musik player: vários ataques agendados no relógio do
// áudio, um atrás do outro. Usa um caminho próprio (com o mesmo "corpo" de
// violão), para o botão de play da aba Acordes não cortar o acompanhamento.
// ---------------------------------------------------------------------------

let songBody: Tone.Gain | null = null
let songVoices: Tone.ToneBufferSource[] = []

/** Relógio do áudio (s), o mesmo usado por strumAt. */
export const audioNow = () => Tone.getContext().currentTime

/** Libera o áudio e aplica o volume da aba Acordes. Chamar dentro do clique. */
export async function startSongAudio() {
  await Tone.start()
  setup()
  songBody ??= makeBody(volume!)
  setVolume(readStored('volume', 0.8), readStored('mudo', false))
}

/**
 * Agenda um ataque do acorde no instante `when` (relógio do áudio). Para
 * baixo: da 6ª para a 1ª corda; para cima: só as 4 cordas mais agudas, da 1ª
 * para baixo, mais fraco. O som anterior é abafado no mesmo instante.
 */
export function strumAt(shape: Shape, when: number, opts: { up?: boolean; velocity?: number; strumMs?: number } = {}) {
  if (!songBody) return
  const strumMs = opts.strumMs ?? (opts.up ? 12 : 18)
  const velocity = opts.velocity ?? (opts.up ? 0.55 : 0.9)
  songVoices = songVoices.filter((v) => {
    v.stop(when + 0.01)
    return false
  })
  const strings = shape.frets.map((fret, s) => ({ fret, s })).filter((x) => x.fret >= 0)
  const order = opts.up ? strings.reverse().slice(0, 4) : strings
  order.forEach(({ fret, s }, k) => {
    const src = new Tone.ToneBufferSource(bufferFor(s, noteAt(s, fret), fret)).connect(songBody!)
    src.fadeOut = 0.06
    src.start(when + (k * strumMs) / 1000, 0, undefined, velocity * (0.9 + Math.random() * 0.1))
    songVoices.push(src)
  })
}

/** Cala na hora tudo o que o acompanhamento agendou. */
export function stopSongAudio() {
  const now = Tone.getContext().currentTime
  songVoices.forEach((v) => v.stop(now + 0.02))
  songVoices = []
}

/** Toca a forma com o volume, o mudo e a velocidade do ataque escolhidos na aba Acordes. */
export function playShapeWithPrefs(shape: Shape, onPluck: (stringIndex: number) => void = () => {}) {
  playShape(
    shape,
    readStored('volume', 0.8),
    readStored('mudo', false),
    readStored('velocidade-ataque', STRUM_DELAY_MS),
    onPluck,
  )
}
