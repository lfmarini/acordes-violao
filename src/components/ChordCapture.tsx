import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { chordDisplayName, type ChordRef } from '../lib/chords'
import { PC_NAMES, analyzeSpectrum, rankChords, type Guess } from '../lib/recognize'

// ---------------------------------------------------------------------------
// Captura de acorde pelo microfone ("Shazam" do app).
// 1. Mede o ruído do ambiente por um instante.
// 2. Espera o violão soar (volume acima do ruído).
// 3. Escuta por LISTEN_S segundos, somando as notas ouvidas (cromagrama).
// 4. Compara com os acordes conhecidos e mostra os mais prováveis.
// O som não sai do aparelho: tudo é analisado no próprio navegador.
// ---------------------------------------------------------------------------

/** Quanto tempo ouvir depois que o acorde começa a soar, em segundos. */
const LISTEN_S = 1.8
/** Tempo máximo esperando o acorde, em segundos. */
const WAIT_S = 10
const FFT_SIZE = 16384
const TICK_MS = 50

type Phase = 'idle' | 'calibrating' | 'waiting' | 'listening' | 'done' | 'error'

interface Props {
  open: boolean
  onClose: () => void
  onPick: (c: ChordRef) => void
}

export function ChordCapture({ open, onClose, onPick }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [live, setLive] = useState<number[]>(new Array(12).fill(0))
  const [guesses, setGuesses] = useState<Guess[]>([])
  const [error, setError] = useState('')
  const stopRef = useRef<() => void>(() => {})

  const stop = useCallback(() => stopRef.current(), [])

  const start = useCallback(async () => {
    stop()
    setGuesses([])
    setError('')
    setLive(new Array(12).fill(0))
    setPhase('calibrating')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Sem os "filtros de voz" do navegador, que atrapalham a música.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      setError(
        denied
          ? 'O navegador não liberou o microfone. Clique no cadeado ao lado do endereço do site, permita o microfone e tente de novo.'
          : 'Não encontrei um microfone neste aparelho.',
      )
      setPhase('error')
      return
    }

    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = FFT_SIZE
    analyser.smoothingTimeConstant = 0
    source.connect(analyser)

    const db = new Float32Array(analyser.frequencyBinCount)
    const mag = new Float32Array(analyser.frequencyBinCount)
    const wave = new Float32Array(2048)
    const chroma = new Array(12).fill(0)
    const bass = new Array(12).fill(0)

    let noise = 0
    let noiseFrames = 0
    let state: Phase = 'calibrating'
    const t0 = performance.now()
    let onset = 0

    const rms = () => {
      analyser.getFloatTimeDomainData(wave)
      let s = 0
      for (const v of wave) s += v * v
      return Math.sqrt(s / wave.length)
    }

    const finish = (result: Phase) => {
      clearInterval(timer)
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
      stopRef.current = () => {}
      if (result === 'done') setGuesses(rankChords(chroma, bass))
      setPhase(result)
    }

    const timer = window.setInterval(() => {
      const now = performance.now()
      const level = rms()
      if (state === 'calibrating') {
        noise += level
        noiseFrames++
        if (now - t0 > 500) {
          noise /= noiseFrames
          state = 'waiting'
          setPhase('waiting')
        }
        return
      }
      if (state === 'waiting') {
        if (level > Math.max(noise * 4, 0.01)) {
          state = 'listening'
          onset = now
          setPhase('listening')
        } else if (now - t0 > WAIT_S * 1000) {
          setError('Não ouvi nenhum acorde. Toque mais perto do microfone e tente de novo.')
          finish('error')
        }
        return
      }
      // Ouvindo: pula o primeiro instante (o "ataque" é só ruído) e acumula.
      if (now - onset < 80) return
      analyser.getFloatFrequencyData(db)
      for (let i = 0; i < db.length; i++) mag[i] = Math.pow(10, db[i] / 20)
      const frame = analyzeSpectrum(mag, ctx.sampleRate, FFT_SIZE)
      frame.chroma.forEach((v, i) => (chroma[i] += v))
      frame.bass.forEach((v, i) => (bass[i] += v))
      const m = Math.max(...chroma) || 1
      setLive(chroma.map((v) => v / m))
      if (now - onset > LISTEN_S * 1000) finish('done')
    }, TICK_MS)

    stopRef.current = () => finish('idle')
  }, [stop])

  // Fechar o quadro desliga o microfone e limpa o resultado.
  const close = useCallback(() => {
    stop()
    setPhase('idle')
    setGuesses([])
    onClose()
  }, [stop, onClose])
  useEffect(() => stop, [stop])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  const busy = phase === 'calibrating' || phase === 'waiting' || phase === 'listening'
  const message = {
    idle: 'Toque no microfone e depois toque o acorde no violão.',
    calibrating: 'Medindo o silêncio do ambiente…',
    waiting: 'Pode tocar o acorde agora!',
    listening: 'Ouvindo…',
    done: guesses[0] && guesses[0].score > 0.35 ? 'Acho que é este:' : 'Não tenho certeza. Os mais parecidos são:',
    error,
  }[phase]

  const [best, ...others] = guesses

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-end bg-black/70 backdrop-blur-sm sm:place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Capturar acorde pelo microfone"
            className="w-full rounded-t-3xl border border-line bg-panel p-6 shadow-2xl sm:max-w-md sm:rounded-3xl"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">Capturar acorde</h2>
              <button onClick={close} aria-label="Fechar" className="rounded-lg px-2 py-1 text-2xl leading-none text-slate-400 hover:bg-white/5">
                ×
              </button>
            </div>

            {/* Botão do microfone com ondas enquanto escuta */}
            <div className="relative mx-auto my-4 grid h-40 w-40 place-items-center">
              {busy &&
                [0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="absolute inset-0 rounded-full border-2 border-accent-2"
                    initial={{ scale: 0.6, opacity: 0.7 }}
                    animate={{ scale: 1.25, opacity: 0 }}
                    transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.6, ease: 'easeOut' }}
                  />
                ))}
              <button
                onClick={busy ? stop : start}
                aria-label={busy ? 'Parar' : 'Ouvir o acorde'}
                className={`relative grid h-28 w-28 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-[#fff] shadow-2xl shadow-accent/40 transition hover:scale-105 active:scale-95 ${
                  phase === 'listening' ? 'animate-pulse' : ''
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-12 w-12" fill="currentColor" aria-hidden>
                  <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
                </svg>
              </button>
            </div>

            <p role="status" className={`text-center text-sm ${phase === 'error' ? 'text-rose-300' : 'text-slate-300'}`}>
              {message}
            </p>

            {/* Notas ouvidas, ao vivo */}
            {(phase === 'listening' || phase === 'done') && (
              <div className="mt-4 grid grid-cols-12 items-end gap-1" aria-hidden>
                {live.map((v, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div className="flex h-14 w-full items-end overflow-hidden rounded bg-white/5">
                      <motion.div className="w-full rounded bg-accent-2" animate={{ height: `${Math.round(v * 100)}%` }} transition={{ duration: 0.1 }} />
                    </div>
                    <span className="text-[9px] text-slate-500">{PC_NAMES[i]}</span>
                  </div>
                ))}
              </div>
            )}

            {phase === 'done' && best && (
              <div className="mt-5 space-y-3">
                <button
                  onClick={() => {
                    onPick(best.chord)
                    close()
                  }}
                  className="flex w-full items-center justify-between rounded-2xl border border-accent-2/60 bg-accent-2/10 px-4 py-3 text-left hover:bg-accent-2/20"
                >
                  <span>
                    <span className="block font-display text-4xl font-bold">{chordDisplayName(best.chord)}</span>
                    <span className="block text-xs text-slate-400">notas: {best.notes.join(' – ') || '—'}</span>
                  </span>
                  <span className="text-right text-sm text-accent-2">
                    {Math.round(best.score * 100)}%
                    <span className="block text-xs text-slate-400">ver no braço →</span>
                  </span>
                </button>
                {others.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-xs text-slate-500">Ou talvez:</span>
                    {others.map((g) => (
                      <button
                        key={chordDisplayName(g.chord)}
                        onClick={() => {
                          onPick(g.chord)
                          close()
                        }}
                        className="rounded-full border border-line px-3 py-1 font-display font-semibold hover:border-slate-500"
                      >
                        {chordDisplayName(g.chord)} <span className="text-xs font-normal text-slate-500">{Math.round(g.score * 100)}%</span>
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={start} className="w-full rounded-xl bg-white/5 py-2 text-sm text-slate-300 hover:bg-white/10">
                  Ouvir de novo
                </button>
              </div>
            )}

            <p className="mt-4 text-center text-[11px] text-slate-500">
              Dica: toque o acorde uma vez, deixando soar. O som é analisado só no seu aparelho.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
