import { useCallback, useEffect, useRef, useState } from 'react'
import { ANALYSIS_SR, analyzeSamples, decodeToMono, resample, trackFromAnalysis, trimLeadingSilence } from './audioAnalysis'
import type { ChordTrack } from './chordMidi'
import type { NoiseLevel } from './denoise'
import { levelDb, micErrorMessage, openMicrophone, type MicSession } from './microphone'
import type { ChordSource } from './song'
import { readStored } from './storage'

// ---------------------------------------------------------------------------
// Estado das alternativas sem MIDI: análise de um arquivo de áudio e escuta
// pelo microfone (gravação + análise). Usado pela aba Musik player.
// ---------------------------------------------------------------------------

export interface Busy {
  progress: number // 0 a 1
  stage: string
}

export function useChordAnalysis(onTrack: (track: ChordTrack, source: ChordSource, note?: string) => void) {
  const [busy, setBusy] = useState<Busy | null>(null)
  const [error, setError] = useState('')
  const [mic, setMic] = useState<{ seconds: number; db: number } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const session = useRef<MicSession | null>(null)
  const raf = useRef(0)
  const cb = useRef(onTrack)
  useEffect(() => {
    cb.current = onTrack
  })

  const run = useCallback(async (samples: Float32Array, source: ChordSource, offset: number, note?: string) => {
    abort.current = new AbortController()
    try {
      const r = await analyzeSamples(samples, (progress, stage) => setBusy({ progress, stage }), abort.current.signal)
      if (!r.chords.length) throw new Error('não encontrei batidas nem acordes nesse som')
      cb.current(trackFromAnalysis(r, samples.length / ANALYSIS_SR, offset), source, note)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(`A análise falhou: ${e instanceof Error ? e.message : e}.`)
    } finally {
      setBusy(null)
      abort.current = null
    }
  }, [])

  /** Arquivo MP3/M4A/OGG/WAV. */
  const analyzeFile = useCallback(
    async (file: File) => {
      setError('')
      setBusy({ progress: 0, stage: 'Abrindo o arquivo' })
      let samples: Float32Array
      try {
        samples = await decodeToMono(await file.arrayBuffer())
      } catch {
        setBusy(null)
        setError(`O navegador não conseguiu abrir "${file.name}". Tente um MP3.`)
        return
      }
      await run(samples, 'audio', 0)
    },
    [run],
  )

  /** Liga o microfone e começa a gravar (reaproveita o módulo da aba Aprendizado). */
  const startMic = useCallback(async () => {
    setError('')
    try {
      session.current = await openMicrophone(readStored<NoiseLevel>('reducao-ruido', 'off'))
    } catch (e) {
      setError(micErrorMessage(e))
      return
    }
    const s = session.current
    if (!s.recorder) {
      s.close()
      session.current = null
      setError('Este navegador não deixa gravar o microfone.')
      return
    }
    const analyser = s.ctx.createAnalyser()
    analyser.fftSize = 2048
    s.input.connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    let last = 0
    const loop = (t: number) => {
      if (t - last > 150) {
        setMic({ seconds: s.recorder?.seconds ?? 0, db: levelDb(analyser, buf) })
        last = t
      }
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
    setMic({ seconds: 0, db: -60 })
  }, [])

  /** Para o microfone e analisa o que foi gravado. */
  const stopMic = useCallback(
    async (analyze = true) => {
      cancelAnimationFrame(raf.current)
      const s = session.current
      session.current = null
      setMic(null)
      if (!s) return
      s.close()
      const rec = s.recorder
      if (!analyze || !rec || rec.seconds < 5) {
        if (analyze) setError('Gravação curta demais: deixe a música tocar pelo menos alguns compassos.')
        return
      }
      setBusy({ progress: 0, stage: 'Preparando a gravação' })
      const pcm = rec.slice()
      const f = new Float32Array(pcm.length)
      for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 0x8000
      const trimmed = trimLeadingSilence(await resample({ data: f, sampleRate: rec.sampleRate }))
      const note = trimmed.trimmed > 0.3 ? `Tirei ${trimmed.trimmed.toFixed(1).replace('.', ',')} s de silêncio do começo da gravação.` : undefined
      await run(trimmed.samples, 'mic', 0, note)
    },
    [run],
  )

  const cancel = useCallback(() => abort.current?.abort(), [])

  // Saiu da página: desliga tudo.
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      session.current?.close()
      abort.current?.abort()
    },
    [],
  )

  return { busy, error, setError, mic, analyzeFile, startMic, stopMic, cancel }
}
