import { useCallback, useEffect, useRef, useState } from 'react'
import { chordDisplayName, type ChordRef } from '../lib/chords'
import { LIVE_GATE_DB, LiveDetector, liveLabel, type LiveResult } from '../lib/liveDetect'
import { analyzeSpectrum, type Frame } from '../lib/recognize'
import { NOISE_LEVELS, setNoiseLevel, type NoiseLevel } from '../lib/denoise'
import { micErrorMessage, openMicrophone, type MicSession } from '../lib/microphone'
import { MAX_RECORD_MIN, MP3_KBPS, Recorder, downloadBlob, recordingFileName } from '../lib/recorder'
import { useStoredState } from '../lib/storage'
import { useTheme } from '../lib/themes'

// ---------------------------------------------------------------------------
// Gráfico da amplitude sonora ao longo do tempo, captada pelo microfone.
// A amplitude é medida em dBFS: 0 dB é o máximo que o microfone registra e
// os valores negativos são sons mais fracos (−60 dB é quase silêncio).
// As batidas do metrônomo aparecem como linhas verticais, para você ver se
// as batidas da mão direita caem no tempo. Embaixo, uma trilha pequena mostra
// o último minuto inteiro. Com o microfone ligado, o app também diz qual
// nota ou acorde está soando e marca as trocas no gráfico.
// ---------------------------------------------------------------------------

/** Janela de tempo do gráfico principal, em segundos. */
const WINDOW_S = 8
/** Janela da trilha de histórico, em segundos. */
const HISTORY_S = 60
const DB_FLOOR = -60
const GRID_DB = [-12, -24, -36, -48]
/** De quanto em quanto tempo (ms) a nota/acorde é recalculada. */
const DETECT_MS = 120
const DETECT_FFT = 16384

export interface BeatMark {
  at: number // performance.now()
  accent: boolean
}

interface Props {
  beats: React.RefObject<BeatMark[]>
  active: boolean
  onPick: (c: ChordRef) => void
  /** Notas (MIDI) ouvidas a cada análise, para o braço da aba Aprendizado. */
  onNotes?: (midis: number[], result: LiveResult, micOn?: boolean) => void
}

// Opções de salvar: segundos (null = a gravação inteira).
const SAVE_OPTIONS = [
  { label: 'Últimos 10 s', seconds: 10 },
  { label: 'Últimos 30 s', seconds: 30 },
  { label: 'Último 1 min', seconds: 60 },
  { label: 'Gravação inteira', seconds: null },
] as const

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

type Format = 'mp3' | 'wav'

// MP3 é o padrão: ~6x menor e toca em qualquer aparelho. WAV guarda o som sem perda.
const FORMATS: { id: Format; label: string; hint: string }[] = [
  { id: 'mp3', label: 'MP3', hint: 'menor, toca em qualquer aparelho' },
  { id: 'wav', label: 'WAV', hint: 'sem perda, ~6x maior' },
]

// Tamanho aproximado do arquivo (mono): MP3 pelo bitrate; WAV = 2 bytes por amostra.
function sizeLabel(seconds: number, format: Format, sampleRate = 48000) {
  const bytes = format === 'mp3' ? (seconds * MP3_KBPS * 1000) / 8 : seconds * sampleRate * 2 + 44
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`
}

const fileName = (seconds: number | null, format: Format) =>
  recordingFileName('acordes-gravacao', seconds ? `${seconds}s` : 'inteira', format)

// Notas tocadas (com a oitava) num quadro de análise: as fundamentais fortes
// e bem afinadas (até 30 cents de uma nota da escala), entre E2 e ~E6.
function notesOf(frame: Frame): number[] {
  const strongest = Math.max(0, ...frame.fundamentals.map((n) => n.strength))
  const out = new Set<number>()
  for (const n of frame.fundamentals) {
    if (n.strength < strongest * 0.45 || n.f < 75 || n.f > 1400) continue
    const midi = 69 + 12 * Math.log2(n.f / 440)
    if (Math.abs(midi - Math.round(midi)) <= 0.3) out.add(Math.round(midi))
  }
  return [...out]
}

const toDb = (rms: number) => Math.max(DB_FLOOR, 20 * Math.log10(Math.max(rms, 1e-6)))

// Ajusta o canvas à tela (nitidez em telas de alta densidade, limitada a 2x).
function prepare(c: HTMLCanvasElement) {
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
  return { g, w, h }
}

export function AmplitudeChart({ beats, active, onPick, onNotes }: Props) {
  const onNotesRef = useRef(onNotes)
  useEffect(() => {
    onNotesRef.current = onNotes
  }, [onNotes])
  const theme = useTheme()
  const canvas = useRef<HTMLCanvasElement>(null)
  const track = useRef<HTMLCanvasElement>(null)
  const samples = useRef<{ t: number; db: number }[]>([])
  const marks = useRef<{ t: number; label: string }[]>([]) // trocas de nota/acorde
  const stopRef = useRef<() => void>(() => {})
  const [on, setOn] = useState(false)
  const [error, setError] = useState('')
  const [level, setLevel] = useState({ now: DB_FLOOR, peak: DB_FLOOR })
  const recorder = useRef<Recorder | null>(null)
  const [recorded, setRecorded] = useState(0) // segundos gravados
  const [live, setLive] = useState<LiveResult>({ kind: 'silence' })
  const [history, setHistory] = useState<string[]>([])
  const [format, setFormat] = useStoredState<Format>('formato-gravacao', 'mp3')
  const [saving, setSaving] = useState<{ label: string; progress: number } | null>(null)
  const [noise, setNoise] = useStoredState<NoiseLevel>('reducao-ruido', 'off')
  const [withClicks, setWithClicks] = useStoredState('gravar-metronomo', true)
  const [replayUrl, setReplayUrl] = useState<string | null>(null)
  const denoiser = useRef<AudioWorkletNode | null>(null)
  const clicks = () => (withClicks ? beats.current ?? [] : undefined)

  // Troca o nível de redução de ruído na hora, mesmo com o microfone ligado.
  useEffect(() => {
    if (denoiser.current) setNoiseLevel(denoiser.current, noise)
  }, [noise])

  // Ouvir a última gravação: para o microfone (para não gravar a própria
  // reprodução) e toca a gravação inteira num player com barra de tempo.
  const replay = () => {
    const rec = recorder.current
    if (!rec || rec.seconds === 0) return
    stopRef.current()
    if (replayUrl) URL.revokeObjectURL(replayUrl)
    setReplayUrl(URL.createObjectURL(rec.toWav(undefined, clicks())))
  }

  const save = async (o: (typeof SAVE_OPTIONS)[number]) => {
    const rec = recorder.current
    if (!rec) return
    const seconds = o.seconds ?? undefined
    if (format === 'wav') {
      downloadBlob(rec.toWav(seconds, clicks()), fileName(o.seconds, 'wav'))
      return
    }
    setSaving({ label: o.label, progress: 0 })
    try {
      const blob = await rec.toMp3(seconds, clicks(), (progress) => setSaving({ label: o.label, progress }))
      downloadBlob(blob, fileName(o.seconds, 'mp3'))
    } catch {
      setError('Não consegui converter para MP3. Tente salvar em WAV.')
    } finally {
      setSaving(null)
    }
  }

  // Posição da visualização. \`liveRef\`: microfone ligado (o fim da trilha é
  // "agora"). \`cursorRef\`: fim da janela de 8 s quando você arrasta a trilha
  // ou o replay está tocando (null = acompanha o fim).
  const liveRef = useRef(false)
  const cursorRef = useRef<number | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [browsing, setBrowsing] = useState(false)

  const endTime = useCallback(
    () =>
      liveRef.current || !samples.current.length ? performance.now() : samples.current[samples.current.length - 1].t,
    [],
  )
  // Instante (no relógio das amostras) que o replay está tocando agora.
  const playTime = useCallback(() => {
    const au = audioRef.current
    const rec = recorder.current
    if (!au || !rec || !au.src) return null
    return rec.startTime + au.currentTime * 1000
  }, [])

  const draw = useCallback(() => {
    const K = theme.chart
    const end = endTime()
    const view = Math.min(end, cursorRef.current ?? end) // fim da janela de 8 s
    const play = playTime()

    // ---- Gráfico principal (8 s) ----
    if (canvas.current) {
      const { g, w, h } = prepare(canvas.current)
      const left = 34
      const plotW = w - left - 6
      const x = (t: number) => left + plotW * (1 - (view - t) / (WINDOW_S * 1000))
      const y = (db: number) => 20 + (h - 38) * (db / DB_FLOOR)
      const inView = (t: number) => t <= view && view - t <= WINDOW_S * 1000

      g.font = '10px Inter Variable, sans-serif'
      g.fillStyle = K.axis
      g.strokeStyle = K.grid
      g.lineWidth = 1
      for (const db of [0, ...GRID_DB, DB_FLOOR]) {
        g.beginPath()
        g.moveTo(left, y(db))
        g.lineTo(w - 6, y(db))
        g.stroke()
        g.fillText(`${db}`, 2, y(db) + 3)
      }
      // Tempo em relação ao fim da gravação ("agora" quando ao vivo).
      for (let s = 0; s <= WINDOW_S; s += 2) {
        const xx = left + plotW * (1 - s / WINDOW_S)
        const ago = Math.round((end - view) / 1000) + s
        const label = ago === 0 ? (liveRef.current ? 'agora' : 'fim') : `-${ago}s`
        g.fillText(label, xx - (s === 0 ? 22 : 8), h - 4)
      }

      for (const bt of beats.current ?? []) {
        if (!inView(bt.at)) continue
        g.strokeStyle = bt.accent ? `rgba(${K.beat},0.8)` : `rgba(${K.beat},0.35)`
        g.lineWidth = bt.accent ? 2 : 1
        g.beginPath()
        g.moveTo(x(bt.at), 20)
        g.lineTo(x(bt.at), h - 18)
        g.stroke()
      }

      const pts = samples.current.filter((pt) => inView(pt.t))
      if (pts.length > 1) {
        const grad = g.createLinearGradient(0, y(0), 0, y(DB_FLOOR))
        grad.addColorStop(0, K.fill[0])
        grad.addColorStop(0.35, K.fill[1])
        grad.addColorStop(1, K.fill[2])
        g.beginPath()
        g.moveTo(x(pts[0].t), y(DB_FLOOR))
        for (const pt of pts) g.lineTo(x(pt.t), y(pt.db))
        g.lineTo(x(pts[pts.length - 1].t), y(DB_FLOOR))
        g.closePath()
        g.fillStyle = grad
        g.fill()
        g.beginPath()
        pts.forEach((pt, i) => (i ? g.lineTo(x(pt.t), y(pt.db)) : g.moveTo(x(pt.t), y(pt.db))))
        g.strokeStyle = K.line
        g.lineWidth = 1.5
        g.stroke()
      }

      // Nomes das notas/acordes identificados, no momento em que começaram.
      g.font = '600 11px Space Grotesk Variable, sans-serif'
      for (const m of marks.current) {
        if (!inView(m.t)) continue
        const xx = x(m.t)
        g.fillStyle = K.mark
        g.fillRect(xx, 4, 1.5, 12)
        g.fillText(m.label, xx + 4, 14)
      }

      // Onde o replay está tocando.
      if (play !== null && inView(play)) {
        g.strokeStyle = K.playhead
        g.lineWidth = 2
        g.beginPath()
        g.moveTo(x(play), 18)
        g.lineTo(x(play), h - 16)
        g.stroke()
      }
    }

    // ---- Trilha de histórico (último 1 min) ----
    if (track.current) {
      const { g, w, h } = prepare(track.current)
      const x = (t: number) => w * (1 - (end - t) / (HISTORY_S * 1000))
      // Colunas: o maior volume de cada fatia de tempo.
      const cols = Math.max(1, Math.floor(w / 3))
      const slice = (HISTORY_S * 1000) / cols
      const maxes = new Array(cols).fill(DB_FLOOR)
      for (const pt of samples.current) {
        const k = Math.floor((pt.t - (end - HISTORY_S * 1000)) / slice)
        if (k >= 0 && k < cols) maxes[k] = Math.max(maxes[k], pt.db)
      }
      g.fillStyle = theme.ui.accent2
      maxes.forEach((db, k) => {
        const bh = (h - 4) * (1 - db / DB_FLOOR)
        if (bh > 0.5) g.fillRect(k * (w / cols), h - 2 - bh, Math.max(1, w / cols - 1), bh)
      })
      // Trecho que aparece no gráfico grande (arraste para mudar).
      const x0 = x(view - WINDOW_S * 1000)
      const x1 = x(view)
      g.fillStyle = `rgba(${K.beat},0.22)`
      g.fillRect(x0, 0, x1 - x0, h)
      g.strokeStyle = `rgba(${K.beat},0.95)`
      g.lineWidth = 1.5
      g.strokeRect(x0 + 0.75, 0.75, x1 - x0 - 1.5, h - 1.5)
      g.fillStyle = K.mark
      for (const m of marks.current) if (end - m.t <= HISTORY_S * 1000) g.fillRect(x(m.t), 0, 1, 5)
      if (play !== null) {
        g.fillStyle = K.playhead
        g.fillRect(x(play) - 1, 0, 2, h)
      }
    }
  }, [beats, endTime, playTime, theme])

  // Arrastar (ou tocar) a trilha de 1 min: a janela de 8 s fica centrada no
  // ponto escolhido e, se o replay estiver aberto, ele pula para lá.
  const scrub = (clientX: number) => {
    const el = track.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const end = endTime()
    const t = end - HISTORY_S * 1000 + ((clientX - r.left) / r.width) * HISTORY_S * 1000
    const first = samples.current[0]?.t ?? end
    const cursor = Math.max(Math.min(t + (WINDOW_S * 1000) / 2, end), Math.min(end, first + WINDOW_S * 1000))
    cursorRef.current = cursor >= end - 100 ? null : cursor
    setBrowsing(cursorRef.current !== null)
    const au = audioRef.current
    const rec = recorder.current
    if (au && rec && replayUrl) au.currentTime = Math.max(0, Math.min(au.duration || Infinity, (t - rec.startTime) / 1000))
    draw()
  }
  const backToLive = () => {
    cursorRef.current = null
    setBrowsing(false)
    draw()
  }

  // Durante o replay, o gráfico acompanha o que está tocando.
  useEffect(() => {
    const au = audioRef.current
    if (!au || !replayUrl) return
    let raf = 0
    const tick = () => {
      const play = playTime()
      if (play !== null && !au.paused) {
        cursorRef.current = Math.min(endTime(), play + (WINDOW_S * 1000) / 2)
        setBrowsing(true)
      }
      draw()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [replayUrl, draw, endTime, playTime])

  const start = async () => {
    setError('')
    if (replayUrl) {
      URL.revokeObjectURL(replayUrl)
      setReplayUrl(null)
    }
    // Microfone + redução de ruído + gravação (uma nova gravação apaga a anterior).
    let mic: MicSession
    try {
      mic = await openMicrophone(noise)
    } catch (e) {
      setError(micErrorMessage(e))
      return
    }
    const { ctx, input } = mic
    denoiser.current = mic.denoiser
    recorder.current = mic.recorder
    const analyser = ctx.createAnalyser() // volume
    analyser.fftSize = 2048
    input.connect(analyser)
    const spectrum = ctx.createAnalyser() // notas (precisa de mais resolução)
    spectrum.fftSize = DETECT_FFT
    spectrum.smoothingTimeConstant = 0
    input.connect(spectrum)
    setRecorded(0)
    samples.current = []
    marks.current = []
    setHistory([])

    const wave = new Float32Array(analyser.fftSize)
    const dbSpec = new Float32Array(spectrum.frequencyBinCount)
    const mag = new Float32Array(spectrum.frequencyBinCount)
    const detector = new LiveDetector()
    let lastLabel = ''
    let peak = DB_FLOOR
    let raf = 0
    let lastUi = 0
    let lastDetect = 0
    let prevNotes = new Set<number>()

    const loop = () => {
      analyser.getFloatTimeDomainData(wave)
      let s = 0
      for (const v of wave) s += v * v
      const db = toDb(Math.sqrt(s / wave.length))
      const t = performance.now()
      samples.current.push({ t, db })
      while (samples.current.length && t - samples.current[0].t > HISTORY_S * 1000) samples.current.shift()
      peak = Math.max(peak - 0.05, db) // o pico desce devagar

      if (t - lastDetect >= DETECT_MS) {
        const dt = lastDetect ? (t - lastDetect) / 1000 : DETECT_MS / 1000
        lastDetect = t
        spectrum.getFloatFrequencyData(dbSpec)
        for (let i = 0; i < dbSpec.length; i++) mag[i] = Math.pow(10, dbSpec[i] / 20)
        const frame = analyzeSpectrum(mag, ctx.sampleRate, DETECT_FFT)
        const result = detector.update(frame, db, dt)
        const now = db >= LIVE_GATE_DB ? notesOf(frame) : []
        // Só vale a nota que aparece em duas análises seguidas (evita "piscadas" no ataque).
        onNotesRef.current?.(now.filter((m) => prevNotes.has(m)), result)
        prevNotes = new Set(now)
        const label = liveLabel(result)
        if (label !== lastLabel) {
          lastLabel = label
          setLive(result)
          if (label && result.kind !== 'notes') {
            marks.current.push({ t, label })
            while (marks.current.length && t - marks.current[0].t > HISTORY_S * 1000) marks.current.shift()
            setHistory((h) => [label, ...h].slice(0, 12))
          }
        } else if (result.kind === 'note') setLive(result) // atualiza os cents
      }

      if (t - lastUi > 150) {
        setLevel({ now: db, peak })
        setRecorded(recorder.current?.seconds ?? 0)
        lastUi = t
      }
      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    liveRef.current = true
    cursorRef.current = null
    setBrowsing(false)
    setOn(true)

    stopRef.current = () => {
      cancelAnimationFrame(raf)
      mic.close()
      setRecorded(recorder.current?.seconds ?? 0)
      setLive({ kind: 'silence' })
      onNotesRef.current?.([], { kind: 'silence' }, false)
      denoiser.current = null
      liveRef.current = false
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
    const els = [canvas.current, track.current].filter(Boolean) as HTMLCanvasElement[]
    const ro = new ResizeObserver(() => draw())
    els.forEach((el) => ro.observe(el))
    return () => ro.disconnect()
  }, [draw])

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-panel/80 p-3 backdrop-blur sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-bold">Amplitude sonora</h2>
        <button onClick={() => (on ? stopRef.current() : void start())} className={`btn btn-round ${on ? 'btn-danger' : 'btn-primary'}`}>
          {on ? '■ Parar microfone' : '● Ligar microfone'}
        </button>
      </div>

      {/* O que está soando agora */}
      <LiveReadout on={on} live={live} onPick={onPick} />

      <div className="relative mt-3">
        <canvas ref={canvas} className="h-56 w-full rounded-xl bg-black/30 sm:h-64" aria-label="Gráfico da amplitude sonora nos últimos 8 segundos" />
        {/* Botão pequeno: prende o gráfico no tempo real (ou volta ao fim da gravação) */}
        {(on || browsing) && (
          <button
            onClick={backToLive}
            aria-pressed={on && !browsing}
            title={on ? 'Manter o gráfico em tempo real' : 'Ir para o fim da gravação'}
            className={`btn btn-round absolute top-1.5 right-1.5 gap-1.5 px-2.5 py-0.5 text-[11px] ${on && !browsing ? 'btn-primary' : ''}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${on && !browsing ? 'animate-pulse bg-emerald-300' : 'bg-slate-500'}`} aria-hidden />
            {on ? 'Tempo real' : 'Ir para o fim'}
          </button>
        )}
      </div>

      {/* Trilha pequena: o último minuto, com o trecho do gráfico grande destacado */}
      <div className="mt-2">
        <canvas
          ref={track}
          className="h-12 w-full cursor-ew-resize touch-none rounded-lg bg-black/30"
          aria-label="Histórico da amplitude no último minuto. Arraste para ver outro trecho no gráfico grande."
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            scrub(e.clientX)
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e.clientX)
          }}
        />
        <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
          <span>-1 min</span>
          <span>{browsing ? 'arraste para escolher o trecho' : '-30 s'}</span>
          <span>{on ? 'agora' : 'fim'}</span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span className="text-slate-400">
          Agora: <strong className="tabular-nums text-white">{on ? `${level.now.toFixed(0)} dB` : '—'}</strong>
        </span>
        <span className="text-slate-400">
          Pico: <strong className="tabular-nums text-white">{on ? `${level.peak.toFixed(0)} dB` : '—'}</strong>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="inline-block h-3 w-0.5 bg-accent" /> batida do metrônomo
        </span>
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="inline-block h-3 w-0.5 bg-amber-300" /> nota/acorde identificado
        </span>
      </div>
      {history.length > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          Sequência: <span className="font-display text-slate-200">{[...history].reverse().join(' → ')}</span>
        </p>
      )}
      {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}

      {/* Salvar a gravação no aparelho, em MP3 (pequeno) ou WAV (sem perda) */}
      <div className="mt-4 rounded-xl border border-line bg-black/20 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-semibold text-slate-200">Salvar gravação</span>
          <span className="flex items-center gap-2 tabular-nums text-slate-400">
            {on && <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" aria-hidden />}
            {recorded > 0 ? `${fmtTime(recorded)} gravados` : 'nada gravado ainda'}
          </span>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400" role="group" aria-label="Redução de ruído">
          <span className="w-full sm:w-auto">Redução de ruído:</span>
          {NOISE_LEVELS.map((n) => (
            <button
              key={n.id}
              onClick={() => setNoise(n.id)}
              aria-pressed={noise === n.id}
              className={`btn btn-round px-3 py-1 text-xs ${noise === n.id ? 'btn-primary' : ''}`}
            >
              {n.label}
            </button>
          ))}
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400" role="group" aria-label="Metrônomo na gravação">
          <span className="w-full sm:w-auto">Som do metrônomo na gravação:</span>
          {[
            { v: true, label: 'Gravar' },
            { v: false, label: 'Não gravar' },
          ].map((o) => (
            <button
              key={o.label}
              onClick={() => setWithClicks(o.v)}
              aria-pressed={withClicks === o.v}
              className={`btn btn-round px-3 py-1 text-xs ${withClicks === o.v ? 'btn-primary' : ''}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="mb-2 flex items-center gap-2 text-xs text-slate-400" role="group" aria-label="Formato do arquivo">
          Formato:
          {FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFormat(f.id)}
              aria-pressed={format === f.id}
              className={`btn btn-round px-3 py-1 text-xs ${format === f.id ? 'btn-primary' : ''}`}
            >
              {f.label}
            </button>
          ))}
          <span className="text-slate-500">{FORMATS.find((f) => f.id === format)!.hint}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SAVE_OPTIONS.map((o) => {
            const secs = o.seconds ?? recorded
            const enough = o.seconds === null ? recorded > 0 : recorded >= o.seconds
            const busyHere = saving?.label === o.label
            return (
              <button key={o.label} disabled={!enough || !!saving} onClick={() => void save(o)} className="btn flex-col gap-0 px-3 leading-tight">
                <span>{busyHere ? `Convertendo… ${Math.round(saving.progress * 100)}%` : o.label}</span>
                {enough && !busyHere && <span className="text-[10px] font-normal text-slate-400">≈ {sizeLabel(secs, format)}</span>}
              </button>
            )
          })}
        </div>

        {/* Ouvir a última gravação */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={replay} disabled={recorded === 0} className="btn btn-round btn-primary px-4">
            ▶ {on ? 'Parar e ouvir a gravação' : 'Ouvir a última gravação'}
          </button>
          {replayUrl && (
            <audio ref={audioRef} key={replayUrl} src={replayUrl} controls autoPlay className="h-10 min-w-0 flex-1" />
          )}
        </div>

        <p className="mt-2 text-xs text-slate-500">
          O arquivo vai para a pasta de downloads. Dá para salvar com o microfone ligado ou depois de parar. A gravação fica só na
          memória desta página (até {MAX_RECORD_MIN} min) e some ao ligar o microfone de novo ou fechar o app.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          "Gravar" o metrônomo mistura o tic direto no arquivo, no tempo certo. Se o metrônomo sai pelo alto-falante, o microfone também
          pode captá-lo; com fones de ouvido, só entra no arquivo o que você escolher aqui. A redução de ruído tira chiado e barulho
          constante (ventilador, geladeira); a forte limpa mais, mas pode abafar um pouco as notas fracas.
        </p>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        0 dB é o máximo que o microfone capta; −60 dB é quase silêncio. Com o metrônomo ligado, veja se os picos das suas batidas caem
        nas linhas roxas.
      </p>
    </section>
  )
}

// Quadro "Tocando agora": nota (com afinação) ou acorde identificado.
function LiveReadout({ on, live, onPick }: { on: boolean; live: LiveResult; onPick: (c: ChordRef) => void }) {
  let main = '—'
  let sub = on ? 'Toque uma nota ou um acorde…' : 'Ligue o microfone para identificar a nota ou o acorde tocado.'
  let tune: number | null = null
  if (live.kind === 'note') {
    main = live.note
    sub = `nota · ${live.hz.toFixed(1)} Hz`
    tune = live.cents
  } else if (live.kind === 'notes') {
    main = live.notes.join(' + ')
    sub = 'notas soando'
  } else if (live.kind === 'chord') {
    main = chordDisplayName(live.chord)
    sub = `acorde · notas ${live.notes.join(' – ')} · ${Math.round(live.score * 100)}%`
  }
  return (
    <div className="flex items-center gap-4 rounded-xl border border-line bg-black/25 px-4 py-3" aria-live="polite">
      <div className="min-w-0 flex-1">
        <div className="text-xs tracking-wide text-slate-500 uppercase">Tocando agora</div>
        <div className="font-display text-4xl font-bold text-white">{main}</div>
        <div className="truncate text-xs text-slate-400">{sub}</div>
      </div>
      {tune !== null && (
        // Afinação: o ponteiro fica no meio quando a nota está afinada.
        <div className="w-32 shrink-0 text-center">
          <div className="relative h-2 rounded-full bg-white/10">
            <span className="absolute top-0 left-1/2 h-2 w-0.5 -translate-x-1/2 bg-slate-400" />
            <span
              className={`absolute -top-1 h-4 w-1.5 -translate-x-1/2 rounded-full ${Math.abs(tune) <= 5 ? 'bg-emerald-400' : 'bg-amber-300'}`}
              style={{ left: `${50 + Math.max(-50, Math.min(50, tune))}%` }}
            />
          </div>
          <div className={`mt-1 text-xs tabular-nums ${Math.abs(tune) <= 5 ? 'text-emerald-300' : 'text-amber-200'}`}>
            {Math.abs(tune) <= 5 ? 'afinada' : `${tune > 0 ? '+' : ''}${tune} cents`}
          </div>
        </div>
      )}
      {live.kind === 'chord' && (
        <button onClick={() => onPick(live.chord)} className="btn shrink-0 px-3">
          Ver no braço
        </button>
      )}
    </div>
  )
}
