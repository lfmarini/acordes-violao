import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { BPM_DEFAULT, BPM_MAX, BPM_MIN, Metronome, tapTempo, tempoName } from '../lib/metronome'
import { useStoredState } from '../lib/storage'

interface Props {
  /** Avisado a cada batida (para marcar no gráfico de amplitude). */
  onBeat: (beat: number, at: number) => void
  /** Se a aba Aprendizado está aberta (a barra de espaço só funciona nela). */
  active: boolean
  /** Avisado quando o BPM ou o compasso mudam (o violão virtual usa para saber quanto dura um compasso). */
  onTempo?: (bpm: number, beatsPerBar: number) => void
  /** Muda de valor quando o metrônomo deve parar (ex.: o microfone foi desligado). */
  stopSignal?: number
}

const clampBpm = (v: number) => Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(v)))

export function MetronomePanel({ onBeat, active, onTempo, stopSignal = 0 }: Props) {
  const [bpm, setBpm] = useStoredState('metronomo-bpm', BPM_DEFAULT)
  const [beats, setBeats] = useStoredState('metronomo-compasso', 4)
  const [volume, setVolume] = useStoredState('metronomo-volume', 0.8)
  const [running, setRunning] = useState(false)
  const [current, setCurrent] = useState(-1)
  const metro = useRef<Metronome | null>(null)
  const taps = useRef<number[]>([])
  const onBeatRef = useRef(onBeat)
  useEffect(() => {
    onBeatRef.current = onBeat
  }, [onBeat])

  // Cria o metrônomo uma vez; desliga ao sair da página.
  useEffect(() => {
    const m = new Metronome()
    m.onBeat = (beat, at) => {
      setCurrent(beat)
      onBeatRef.current(beat, at)
    }
    metro.current = m
    return () => m.stop()
  }, [])

  useEffect(() => onTempo?.(bpm, beats), [bpm, beats, onTempo])

  // Mudanças de andamento, compasso e volume valem na hora, mesmo tocando.
  useEffect(() => {
    if (!metro.current) return
    metro.current.bpm = bpm
    metro.current.beatsPerBar = beats
    metro.current.setVolume(volume)
  }, [bpm, beats, volume])

  // Pedido de parada vindo de fora (o microfone foi desligado).
  useEffect(() => {
    if (!stopSignal || !metro.current?.running) return
    metro.current.stop()
    setRunning(false)
    setCurrent(-1)
  }, [stopSignal])

  const toggle = () => {
    const m = metro.current!
    if (m.running) {
      m.stop()
      setRunning(false)
      setCurrent(-1)
    } else {
      m.bpm = bpm
      m.beatsPerBar = beats
      m.setVolume(volume)
      m.start()
      setRunning(true)
    }
  }

  // "Bater o tempo": a média dos intervalos entre os toques vira o BPM.
  const tap = () => {
    const r = tapTempo(taps.current)
    taps.current = r.taps
    if (r.bpm) setBpm(clampBpm(r.bpm))
  }

  // Barra de espaço liga/desliga, só com esta aba aberta e fora de campos e botões.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.code !== 'Space' || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-panel/80 p-3 backdrop-blur sm:p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-display text-xl font-bold">Metrônomo</h2>
        <span className="text-sm text-slate-400">{tempoName(bpm)}</span>
      </div>

      {/* Batidas do compasso: a atual acende */}
      <div className="mb-5 flex justify-center gap-3" aria-hidden>
        {Array.from({ length: beats }, (_, i) => (
          <motion.span
            key={i}
            className={`h-5 w-5 rounded-full ${i === 0 ? 'bg-accent' : 'bg-accent-2'}`}
            animate={{ opacity: current === i ? 1 : 0.18, scale: current === i ? 1.35 : 1 }}
            transition={{ duration: 0.06 }}
          />
        ))}
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => setBpm(clampBpm(bpm - 1))}
          aria-label="Diminuir 1 BPM"
          className="btn btn-round h-12 w-12 p-0 text-2xl"
        >
          −
        </button>
        <div className="w-32 text-center">
          <div className="font-display text-6xl font-bold tabular-nums">{bpm}</div>
          <div className="text-xs tracking-widest text-slate-400">BPM</div>
        </div>
        <button
          onClick={() => setBpm(clampBpm(bpm + 1))}
          aria-label="Aumentar 1 BPM"
          className="btn btn-round h-12 w-12 p-0 text-2xl"
        >
          +
        </button>
      </div>

      <input
        type="range"
        min={BPM_MIN}
        max={BPM_MAX}
        value={bpm}
        onChange={(e) => setBpm(clampBpm(Number(e.target.value)))}
        aria-label="Andamento em batidas por minuto"
        className="mt-4 w-full accent-[var(--color-accent)]"
      />
      <div className="flex justify-between text-xs text-slate-500">
        <span>{BPM_MIN}</span>
        <span>{BPM_MAX}</span>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={toggle}
          className={`btn btn-round min-w-36 px-6 py-3 text-base ${running ? 'btn-danger' : 'btn-primary'}`}
        >
          {running ? '■ Parar' : '▶ Iniciar'}
        </button>
        <button onClick={tap} className="btn btn-round px-5 py-3">
          Bater o tempo
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm">
        <label className="flex items-center gap-2 text-slate-300">
          Compasso
          <select
            value={beats}
            onChange={(e) => setBeats(Number(e.target.value))}
            className="rounded-lg border border-line bg-panel px-2 py-1 text-white"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? 'sem acento' : `${n} tempos`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-slate-300">
          Volume
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Volume do metrônomo"
            className="w-24 accent-[var(--color-accent-2)]"
          />
        </label>
      </div>
      <p className="mt-4 text-center text-xs text-slate-500">
        O 1º tempo de cada compasso soa mais agudo. Toque "Bater o tempo" no ritmo da música para achar o BPM.
      </p>
    </section>
  )
}
