import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_RECORD_MIN, Recorder, downloadBlob } from '../lib/recorder'

// ---------------------------------------------------------------------------
// Gráfico da amplitude sonora ao longo do tempo, captada pelo microfone.
// A amplitude é medida em dBFS: 0 dB é o máximo que o microfone registra e
// os valores negativos são sons mais fracos (−60 dB é quase silêncio).
// As batidas do metrônomo aparecem como linhas verticais, para você ver se
// as batidas da mão direita caem no tempo.
// ---------------------------------------------------------------------------

/** Janela de tempo mostrada no gráfico, em segundos. */
const WINDOW_S = 8
const DB_FLOOR = -60
const GRID_DB = [-12, -24, -36, -48]

export interface BeatMark {
  at: number // performance.now()
  accent: boolean
}

interface Props {
  beats: React.RefObject<BeatMark[]>
  active: boolean
}

// Opções de salvar: segundos (null = a gravação inteira).
const SAVE_OPTIONS = [
  { label: 'Últimos 10 s', seconds: 10 },
  { label: 'Últimos 30 s', seconds: 30 },
  { label: 'Último 1 min', seconds: 60 },
  { label: 'Gravação inteira', seconds: null },
] as const

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function fileName(seconds: number | null) {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}`
  return `acordes-gravacao_${stamp}_${seconds ? `${seconds}s` : 'inteira'}.wav`
}

const toDb = (rms: number) => Math.max(DB_FLOOR, 20 * Math.log10(Math.max(rms, 1e-6)))

export function AmplitudeChart({ beats, active }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const samples = useRef<{ t: number; db: number }[]>([])
  const stopRef = useRef<() => void>(() => {})
  const [on, setOn] = useState(false)
  const [error, setError] = useState('')
  const [level, setLevel] = useState({ now: DB_FLOOR, peak: DB_FLOOR })
  const recorder = useRef<Recorder | null>(null)
  const [recorded, setRecorded] = useState(0) // segundos gravados

  const draw = useCallback(() => {
    const c = canvas.current
    if (!c) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = c.clientWidth
    const h = c.clientHeight
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)

    const left = 34
    const plotW = w - left - 6
    const now = performance.now()
    const x = (t: number) => left + plotW * (1 - (now - t) / (WINDOW_S * 1000))
    const y = (db: number) => 6 + (h - 24) * (db / DB_FLOOR)

    // Grade e escala em dB
    g.font = '10px Inter Variable, sans-serif'
    g.fillStyle = '#64748b'
    g.strokeStyle = 'rgba(255,255,255,0.06)'
    g.lineWidth = 1
    for (const db of [0, ...GRID_DB, DB_FLOOR]) {
      g.beginPath()
      g.moveTo(left, y(db))
      g.lineTo(w - 6, y(db))
      g.stroke()
      g.fillText(`${db}`, 2, y(db) + 3)
    }
    // Segundos no eixo de baixo
    for (let s = 0; s <= WINDOW_S; s += 2) {
      const xx = left + plotW * (1 - s / WINDOW_S)
      g.fillText(s === 0 ? 'agora' : `-${s}s`, xx - (s === 0 ? 28 : 8), h - 4)
    }

    // Batidas do metrônomo
    for (const b of beats.current ?? []) {
      if (b.at > now || now - b.at > WINDOW_S * 1000) continue
      g.strokeStyle = b.accent ? 'rgba(124,92,255,0.8)' : 'rgba(124,92,255,0.35)'
      g.lineWidth = b.accent ? 2 : 1
      g.beginPath()
      g.moveTo(x(b.at), 6)
      g.lineTo(x(b.at), h - 18)
      g.stroke()
    }

    // Curva da amplitude, preenchida com degradê
    const pts = samples.current.filter((p) => now - p.t <= WINDOW_S * 1000)
    samples.current = pts
    if (pts.length > 1) {
      const grad = g.createLinearGradient(0, y(0), 0, y(DB_FLOOR))
      grad.addColorStop(0, 'rgba(255,92,108,0.9)')
      grad.addColorStop(0.35, 'rgba(34,211,238,0.7)')
      grad.addColorStop(1, 'rgba(34,211,238,0.05)')
      g.beginPath()
      g.moveTo(x(pts[0].t), y(DB_FLOOR))
      for (const p of pts) g.lineTo(x(p.t), y(p.db))
      g.lineTo(x(pts[pts.length - 1].t), y(DB_FLOOR))
      g.closePath()
      g.fillStyle = grad
      g.fill()
      g.beginPath()
      pts.forEach((p, i) => (i ? g.lineTo(x(p.t), y(p.db)) : g.moveTo(x(p.t), y(p.db))))
      g.strokeStyle = '#67e8f9'
      g.lineWidth = 1.5
      g.stroke()
    }
  }, [beats])

  const start = async () => {
    setError('')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      setError(
        denied
          ? 'O navegador não liberou o microfone. Clique no cadeado ao lado do endereço do site e permita o microfone.'
          : 'Não encontrei um microfone neste aparelho.',
      )
      return
    }
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    const source = ctx.createMediaStreamSource(stream)
    source.connect(analyser)
    // Grava tudo enquanto o microfone está ligado (uma nova gravação apaga a anterior).
    const rec = new Recorder()
    try {
      await rec.attach(ctx, source)
      recorder.current = rec
    } catch {
      recorder.current = null // sem gravação neste navegador; o gráfico segue funcionando
    }
    setRecorded(0)
    const wave = new Float32Array(analyser.fftSize)
    let peak = DB_FLOOR
    let raf = 0
    let lastUi = 0

    const loop = () => {
      analyser.getFloatTimeDomainData(wave)
      let s = 0
      for (const v of wave) s += v * v
      const db = toDb(Math.sqrt(s / wave.length))
      const t = performance.now()
      samples.current.push({ t, db })
      peak = Math.max(peak - 0.05, db) // o pico desce devagar
      if (t - lastUi > 150) {
        setLevel({ now: db, peak })
        setRecorded(recorder.current?.seconds ?? 0)
        lastUi = t
      }
      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    setOn(true)

    stopRef.current = () => {
      cancelAnimationFrame(raf)
      recorder.current?.detach()
      setRecorded(recorder.current?.seconds ?? 0)
      stream.getTracks().forEach((tr) => tr.stop())
      void ctx.close()
      setOn(false)
      stopRef.current = () => {}
    }
  }

  // Sair da aba ou da página desliga o microfone.
  useEffect(() => {
    if (!active) stopRef.current()
  }, [active])
  useEffect(() => () => stopRef.current(), [])

  // Redesenha a grade vazia quando o tamanho muda.
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(c)
    return () => ro.disconnect()
  }, [draw])

  return (
    <section className="rounded-2xl border border-line bg-panel/80 p-4 backdrop-blur sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-bold">Amplitude sonora</h2>
        <button
          onClick={() => (on ? stopRef.current() : void start())}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition active:scale-95 ${
            on ? 'bg-rose-500/90 text-white' : 'bg-white/10 text-slate-100 hover:bg-white/15'
          }`}
        >
          {on ? '■ Parar microfone' : '● Ligar microfone'}
        </button>
      </div>

      <canvas ref={canvas} className="h-56 w-full rounded-xl bg-black/30 sm:h-64" aria-label="Gráfico da amplitude sonora nos últimos 8 segundos" />

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span className="text-slate-400">
          Agora: <strong className="tabular-nums text-white">{on ? `${level.now.toFixed(0)} dB` : '—'}</strong>
        </span>
        <span className="text-slate-400">
          Pico: <strong className="tabular-nums text-white">{on ? `${level.peak.toFixed(0)} dB` : '—'}</strong>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="inline-block h-3 w-0.5 bg-accent" /> batida do metrônomo
        </span>
      </div>
      {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}

      {/* Salvar a gravação como arquivo .wav no aparelho */}
      <div className="mt-4 rounded-xl border border-line bg-black/20 p-3">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold text-slate-200">Salvar gravação</span>
          <span className="flex items-center gap-2 tabular-nums text-slate-400">
            {on && <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" aria-hidden />}
            {recorded > 0 ? `${fmtTime(recorded)} gravados` : 'nada gravado ainda'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SAVE_OPTIONS.map((o) => {
            const enough = o.seconds === null ? recorded > 0 : recorded >= o.seconds
            return (
              <button
                key={o.label}
                disabled={!enough}
                onClick={() => recorder.current && downloadBlob(recorder.current.toWav(o.seconds ?? undefined), fileName(o.seconds))}
                className="rounded-lg bg-white/5 px-3 py-2 text-sm text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
              >
                {o.label}
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          O arquivo .wav vai para a pasta de downloads. Dá para salvar com o microfone ligado ou depois de parar. A gravação fica só na
          memória desta página (até {MAX_RECORD_MIN} min) e some ao ligar o microfone de novo ou fechar o app.
        </p>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        0 dB é o máximo que o microfone capta; −60 dB é quase silêncio. Com o metrônomo ligado, veja se os picos das suas batidas caem
        nas linhas roxas.
      </p>
    </section>
  )
}
