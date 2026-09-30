import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TakeAnalysis } from '../lib/rhythmAnalysis'
import { histogram, type Hit } from '../lib/rhythmStats'
import { useTheme } from '../lib/themes'

// ---------------------------------------------------------------------------
// Gráficos do treino de ritmo, desenhados à mão em <canvas> (sem biblioteca,
// para funcionar offline):
//  - forma de onda com os beats e os ataques detectados (para conferir);
//  - histograma do d3lay (faixas de 5 ms) com as linhas −x e +x;
//  - evolução: d3lay de cada ataque ao longo da gravação, com a faixa ±x.
// ---------------------------------------------------------------------------

export const OK_COLOR = '#34d399'
export const BAD_COLOR = '#fb7185'
const EXTRA_COLOR = '#fbbf24'
const IGNORED_COLOR = '#94a3b8'

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
  g.font = '10px Inter Variable, sans-serif'
  return { g, w, h }
}

/** Redesenha quando `draw` muda e quando o tamanho do canvas muda. */
function useCanvas(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const run = () => {
      const { g, w, h } = prepare(c)
      draw(g, w, h)
    }
    run()
    const ro = new ResizeObserver(run)
    ro.observe(c)
    return () => ro.disconnect()
  }, [draw])
  return ref
}

const fmtMs = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`

// ---------------------------------------------------------------------------
// Forma de onda
// ---------------------------------------------------------------------------

const BUCKET_S = 0.002

/** Mínimo e máximo do som a cada 2 ms (para desenhar rápido). */
function buckets(samples: Float32Array, sr: number) {
  const size = Math.max(1, Math.round(sr * BUCKET_S))
  const n = Math.ceil(samples.length / size)
  const lo = new Float32Array(n)
  const hi = new Float32Array(n)
  for (let b = 0; b < n; b++) {
    let a = 0
    let z = 0
    const end = Math.min(samples.length, (b + 1) * size)
    for (let i = b * size; i < end; i++) {
      const v = samples[i]
      if (v < a) a = v
      if (v > z) z = v
    }
    lo[b] = a
    hi[b] = z
  }
  return { lo, hi }
}

const ZOOMS = [
  { label: '2 s', s: 2 },
  { label: '4 s', s: 4 },
  { label: '8 s', s: 8 },
  { label: 'tudo', s: 0 },
]

export function WaveformView({
  samples,
  sampleRate,
  analysis,
  tolerance,
}: {
  samples: Float32Array
  sampleRate: number
  analysis: TakeAnalysis
  tolerance: number
}) {
  const K = useTheme().chart
  const env = useMemo(() => buckets(samples, sampleRate), [samples, sampleRate])
  const duration = analysis.duration
  const [zoom, setZoom] = useState(4)
  // Começa perto do 1º beat do exercício.
  const [start, setStart] = useState(() => Math.max(0, (analysis.grid[0]?.time ?? 0) - 0.5))
  const len = zoom === 0 ? duration : Math.min(zoom, duration)
  const view0 = Math.max(0, Math.min(start, duration - len))
  const extras = useMemo(() => new Set(analysis.matching.extras.map((e) => e.time)), [analysis])
  const hitsByTime = useMemo(() => new Map(analysis.matching.hits.map((h) => [h.time, h])), [analysis])

  const draw = useCallback(
    (g: CanvasRenderingContext2D, w: number, h: number) => {
      const x = (t: number) => ((t - view0) / len) * w
      const mid = h / 2 + 6
      const amp = h / 2 - 16
      // Grade: beats (fortes no 1º tempo) e divisões (fracas).
      for (const p of analysis.grid) {
        if (p.time < view0 || p.time > view0 + len) continue
        g.strokeStyle = p.bar ? `rgba(${K.beat},0.9)` : p.main ? `rgba(${K.beat},0.55)` : `rgba(${K.beat},0.25)`
        g.lineWidth = p.bar ? 2 : 1
        g.setLineDash(p.main ? [] : [3, 3])
        g.beginPath()
        g.moveTo(x(p.time), 12)
        g.lineTo(x(p.time), h)
        g.stroke()
      }
      g.setLineDash([])
      // Forma de onda.
      g.fillStyle = K.line
      const b0 = Math.floor(view0 / BUCKET_S)
      const perPx = len / BUCKET_S / w
      for (let px = 0; px < w; px++) {
        const a = Math.floor(b0 + px * perPx)
        const z = Math.max(a + 1, Math.floor(b0 + (px + 1) * perPx))
        let lo = 0
        let hi = 0
        for (let b = a; b < z && b < env.lo.length; b++) {
          if (env.lo[b] < lo) lo = env.lo[b]
          if (env.hi[b] > hi) hi = env.hi[b]
        }
        const y0 = mid - Math.min(1, hi) * amp
        const y1 = mid - Math.max(-1, lo) * amp
        g.fillRect(px, y0, 1, Math.max(1, y1 - y0))
      }
      // Ataques: triângulo no topo (verde acerto, vermelho erro, laranja extra, cinza clique ignorado).
      for (const o of analysis.onsets) {
        if (o.time < view0 || o.time > view0 + len) continue
        const hit = hitsByTime.get(o.time)
        const color = o.click ? IGNORED_COLOR : extras.has(o.time) ? EXTRA_COLOR : hit ? (Math.abs(hit.delay) <= tolerance ? OK_COLOR : BAD_COLOR) : IGNORED_COLOR
        const px = x(o.time)
        g.strokeStyle = color
        g.lineWidth = 1.5
        g.beginPath()
        g.moveTo(px, 12)
        g.lineTo(px, h)
        g.stroke()
        g.fillStyle = color
        g.beginPath()
        g.moveTo(px - 5, 0)
        g.lineTo(px + 5, 0)
        g.lineTo(px, 9)
        g.fill()
        if (hit && len <= 8) {
          g.fillText(`${fmtMs(hit.delay)} ms`, Math.min(w - 40, px + 4), 22)
        }
      }
      // Escala de tempo.
      g.fillStyle = K.axis
      const stepS = len > 30 ? 10 : len > 10 ? 2 : len > 3 ? 1 : 0.5
      for (let t = Math.ceil(view0 / stepS) * stepS; t <= view0 + len; t += stepS) g.fillText(`${t.toFixed(stepS < 1 ? 1 : 0)} s`, x(t) + 2, h - 3)
    },
    [K, analysis, env, extras, hitsByTime, len, tolerance, view0],
  )
  const ref = useCanvas(draw)

  // Arrastar com o dedo/mouse move o trecho.
  const drag = useRef<{ x: number; start: number } | null>(null)
  return (
    <div>
      <canvas
        ref={ref}
        className="h-44 w-full cursor-grab touch-pan-y rounded-xl bg-black/30 sm:h-52"
        aria-label="Forma de onda da gravação com os beats (linhas roxas) e os ataques detectados (triângulos)"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, start: view0 }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const dt = ((drag.current.x - e.clientX) / e.currentTarget.clientWidth) * len
          setStart(Math.max(0, Math.min(duration - len, drag.current.start + dt)))
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>Zoom:</span>
        {ZOOMS.map((z) => (
          <button
            key={z.label}
            onClick={() => setZoom(z.s)}
            aria-pressed={zoom === z.s}
            className={`btn btn-round px-2.5 py-0.5 text-xs ${zoom === z.s ? 'btn-primary' : ''}`}
          >
            {z.label}
          </button>
        ))}
        {len < duration && (
          <input
            type="range"
            min={0}
            max={Math.max(0, duration - len)}
            step={0.05}
            value={view0}
            onChange={(e) => setStart(Number(e.target.value))}
            aria-label="Trecho da gravação"
            className="min-w-24 flex-1 accent-[var(--color-accent)]"
          />
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
        <Legend color={OK_COLOR} label="acerto" />
        <Legend color={BAD_COLOR} label="fora da tolerância" />
        <Legend color={EXTRA_COLOR} label="ataque extra" />
        <Legend color={IGNORED_COLOR} label="ignorado (clique ou fora da grade)" />
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 bg-accent" /> beat (tracejado: divisão)
        </span>
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} /> {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Histograma do d3lay
// ---------------------------------------------------------------------------

export function DelayHistogram({ delays, tolerance }: { delays: number[]; tolerance: number }) {
  const K = useTheme().chart
  const draw = useCallback(
    (g: CanvasRenderingContext2D, w: number, h: number) => {
      const limit = Math.max(tolerance + 10, Math.min(250, Math.ceil(Math.max(0, ...delays.map(Math.abs)) / 5) * 5))
      const bins = histogram(delays, 5, limit)
      const max = Math.max(1, ...bins.map((b) => b.count))
      const left = 24
      const bottom = h - 16
      const x = (ms: number) => left + ((ms + limit) / (2 * limit)) * (w - left - 6)
      const y = (n: number) => bottom - (n / max) * (bottom - 12)
      // Grade e eixo.
      g.fillStyle = K.axis
      g.strokeStyle = K.grid
      for (const n of [0, Math.ceil(max / 2), max]) {
        g.beginPath()
        g.moveTo(left, y(n))
        g.lineTo(w - 6, y(n))
        g.stroke()
        g.fillText(String(n), 2, y(n) + 3)
      }
      // Barras.
      for (const b of bins) {
        if (!b.count) continue
        const inside = Math.abs(b.from) <= tolerance && Math.abs(b.to) <= tolerance
        g.fillStyle = inside ? OK_COLOR : BAD_COLOR
        g.fillRect(x(b.from) + 0.5, y(b.count), Math.max(1, x(b.to) - x(b.from) - 1), bottom - y(b.count))
      }
      // Linhas −x, 0 e +x.
      g.setLineDash([4, 3])
      for (const v of [-tolerance, tolerance]) {
        g.strokeStyle = K.mark
        g.beginPath()
        g.moveTo(x(v), 8)
        g.lineTo(x(v), bottom)
        g.stroke()
      }
      g.setLineDash([])
      g.strokeStyle = K.axis
      g.beginPath()
      g.moveTo(x(0), 8)
      g.lineTo(x(0), bottom)
      g.stroke()
      // Rótulos do eixo x.
      g.fillStyle = K.axis
      const step = limit > 120 ? 50 : limit > 50 ? 25 : 10
      for (let v = -Math.floor(limit / step) * step; v <= limit; v += step) {
        const label = `${fmtMs(v)}`
        g.fillText(label, x(v) - g.measureText(label).width / 2, h - 3)
      }
      g.fillStyle = K.mark
      g.fillText(`−${tolerance}`, x(-tolerance) + 3, 16)
      g.fillText(`+${tolerance}`, x(tolerance) + 3, 16)
    },
    [K, delays, tolerance],
  )
  const ref = useCanvas(draw)
  return (
    <canvas
      ref={ref}
      className="h-44 w-full rounded-xl bg-black/30"
      aria-label={`Histograma do d3lay em faixas de 5 ms, com as linhas de −${tolerance} e +${tolerance} ms`}
    />
  )
}

// ---------------------------------------------------------------------------
// Evolução do d3lay ao longo da gravação
// ---------------------------------------------------------------------------

export function DelayTimeline({ hits, tolerance, start }: { hits: Hit[]; tolerance: number; start: number }) {
  const K = useTheme().chart
  const draw = useCallback(
    (g: CanvasRenderingContext2D, w: number, h: number) => {
      if (!hits.length) return
      const t0 = start
      const t1 = Math.max(t0 + 1, hits[hits.length - 1].time)
      const lim = Math.max(tolerance * 2, Math.min(250, Math.ceil(Math.max(...hits.map((p) => Math.abs(p.delay))) / 10) * 10))
      const left = 30
      const bottom = h - 16
      const x = (t: number) => left + ((t - t0) / (t1 - t0)) * (w - left - 8)
      const y = (d: number) => 8 + ((lim - d) / (2 * lim)) * (bottom - 8)
      // Faixa ±x.
      g.fillStyle = 'rgba(52,211,153,0.12)'
      g.fillRect(left, y(tolerance), w - left - 8, y(-tolerance) - y(tolerance))
      // Linhas de referência.
      g.fillStyle = K.axis
      for (const v of [lim, tolerance, 0, -tolerance, -lim]) {
        g.strokeStyle = v === 0 ? K.axis : K.grid
        g.beginPath()
        g.moveTo(left, y(v))
        g.lineTo(w - 8, y(v))
        g.stroke()
        g.fillText(fmtMs(v), 2, y(v) + 3)
      }
      // Linha ligando os pontos (fraca) e os pontos.
      g.strokeStyle = K.grid
      g.beginPath()
      hits.forEach((p, i) => (i ? g.lineTo(x(p.time), y(p.delay)) : g.moveTo(x(p.time), y(p.delay))))
      g.stroke()
      for (const p of hits) {
        g.fillStyle = Math.abs(p.delay) <= tolerance ? OK_COLOR : BAD_COLOR
        g.beginPath()
        g.arc(x(p.time), y(Math.max(-lim, Math.min(lim, p.delay))), 3, 0, Math.PI * 2)
        g.fill()
      }
      // Tempo (s desde o 1º beat).
      g.fillStyle = K.axis
      const span = t1 - t0
      const step = span > 120 ? 30 : span > 40 ? 10 : span > 12 ? 5 : 1
      for (let t = 0; t <= span; t += step) g.fillText(`${t} s`, x(t0 + t) - 6, h - 3)
    },
    [K, hits, tolerance, start],
  )
  const ref = useCanvas(draw)
  return (
    <canvas
      ref={ref}
      className="h-48 w-full rounded-xl bg-black/30"
      aria-label="d3lay de cada ataque ao longo da gravação, com a faixa de tolerância sombreada"
    />
  )
}
