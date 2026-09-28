import { Key, Note } from 'tonal'
import type { AnalysisMessage } from './audioAnalysis.worker'
import { findDownbeat, type ChordEvent, type ChordTrack } from './chordMidi'
import type { AnalysisOutput } from './essentiaPipeline'
import { sameChord, spell, type SongKey } from './songChords'

// ---------------------------------------------------------------------------
// Alternativa ao MIDI do Chordify: descobrir batidas, tom e acordes a partir
// do áudio (arquivo MP3/M4A/OGG ou gravação do microfone). O trabalho pesado
// roda no Web Worker (audioAnalysis.worker.ts, com Essentia.js); aqui ficam a
// preparação do som e a conversão do resultado para o formato do app.
// ---------------------------------------------------------------------------

export const ANALYSIS_SR = 44100

export type AnalysisResult = AnalysisOutput

/** Converte qualquer áudio que o navegador toca para 44,1 kHz mono. */
export async function decodeToMono(data: ArrayBuffer): Promise<Float32Array> {
  const ctx = new AudioContext()
  try {
    const buf = await ctx.decodeAudioData(data)
    return await resample(buf)
  } finally {
    void ctx.close()
  }
}

/** Amostras (em qualquer taxa) para 44,1 kHz mono, pelo próprio navegador. */
export async function resample(input: AudioBuffer | { data: Float32Array; sampleRate: number }): Promise<Float32Array> {
  let buf: AudioBuffer
  if (input instanceof AudioBuffer) buf = input
  else {
    buf = new AudioBuffer({ length: Math.max(1, input.data.length), sampleRate: input.sampleRate, numberOfChannels: 1 })
    buf.copyToChannel(input.data as Float32Array<ArrayBuffer>, 0)
  }
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * ANALYSIS_SR)), ANALYSIS_SR)
  const src = off.createBufferSource()
  src.buffer = buf // estéreo vira mono na mixagem para 1 canal
  src.connect(off.destination)
  src.start()
  return (await off.startRendering()).getChannelData(0)
}

/**
 * Tira o silêncio do começo (a gravação do microfone começa antes da música).
 * Devolve quantos segundos foram tirados.
 */
export function trimLeadingSilence(s: Float32Array, sampleRate = ANALYSIS_SR, thresholdDb = -45) {
  const win = Math.round(sampleRate * 0.05)
  const limit = Math.pow(10, thresholdDb / 20)
  for (let i = 0; i + win <= s.length; i += win) {
    let sum = 0
    for (let k = i; k < i + win; k++) sum += s[k] * s[k]
    if (Math.sqrt(sum / win) > limit) {
      const start = Math.max(0, i - win)
      return { samples: s.subarray(start), trimmed: start / sampleRate }
    }
  }
  return { samples: s, trimmed: 0 }
}

/** Roda a análise no worker. `onProgress` recebe de 0 a 1 e o nome da etapa. */
export function analyzeSamples(samples: Float32Array, onProgress: (p: number, stage: string) => void, signal?: AbortSignal): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./audioAnalysis.worker.ts', import.meta.url), { type: 'module' })
    const done = () => worker.terminate()
    signal?.addEventListener('abort', () => {
      done()
      reject(new DOMException('cancelado', 'AbortError'))
    })
    worker.onmessage = (e: MessageEvent<AnalysisMessage>) => {
      const m = e.data
      if ('progress' in m) onProgress(m.progress, m.stage)
      else if ('result' in m) {
        done()
        resolve(m.result)
      } else {
        done()
        reject(new Error(m.error))
      }
    }
    worker.onerror = (err) => {
      done()
      reject(new Error(err.message || 'o analisador parou'))
    }
    const copy = samples.slice() // o original continua com quem chamou
    worker.postMessage({ samples: copy }, [copy.buffer])
  })
}

/**
 * Converte o resultado do Essentia no formato do app: um acorde por
 * intervalo entre batidas (iguais seguidos se juntam), grafia pelo tom.
 * `offset` soma segundos a todos os tempos (ex.: silêncio tirado do começo).
 */
export function trackFromAnalysis(r: AnalysisResult, duration: number, offset = 0): ChordTrack {
  const tonicPc = Note.chroma(r.key) ?? 0
  const minor = r.scale === 'minor'
  const alteration = minor ? Key.minorKey(Note.pitchClass(r.key)).alteration : Key.majorKey(Note.pitchClass(r.key)).alteration
  const flats = alteration < 0 || /b/.test(r.key)
  const tonic = spell({ rootPc: tonicPc, q: 'maior', bassPc: tonicPc }, flats).root
  const key: SongKey = { tonic, minor, flats, name: tonic + (minor ? 'm' : '') }

  const ticks = r.ticks.map((t) => t + offset)
  const chords: ChordEvent[] = []
  r.chords.forEach((label, i) => {
    const start = ticks[i]
    const end = ticks[i + 1] ?? start + (ticks[i] - (ticks[i - 1] ?? start - 0.5))
    if (start === undefined) return
    const m = label.match(/^([A-G][#b]?)(m?)$/)
    const chord = m ? spell({ rootPc: Note.chroma(m[1]) ?? 0, q: m[2] ? 'menor' : 'maior', bassPc: Note.chroma(m[1]) ?? 0 }, flats) : null
    const last = chords[chords.length - 1]
    if (last && sameChord(last.chord, chord)) last.end = end
    else chords.push({ start, end, chord })
  })
  const bpm = Math.round(r.bpm * 10) / 10
  return {
    chords,
    beats: ticks,
    beatsPerBar: 4,
    beatUnit: 4,
    bpm,
    key,
    duration: duration + offset,
    downbeat: findDownbeat(chords, ticks, 4),
  }
}
