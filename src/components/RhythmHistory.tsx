import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EXERCISES } from '../lib/exercises'
import { dailyProgress, type RhythmSession } from '../lib/rhythmHistory'
import { useTheme } from '../lib/themes'
import { OK_COLOR } from './RhythmCharts'

// ---------------------------------------------------------------------------
// Histórico do treino de ritmo: gráfico da % de acerto por dia (média do
// dia) de um exercício e a lista das sessões anteriores.
// ---------------------------------------------------------------------------

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
const fmtDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
const npsLabel = (n: number) => (n === 0 ? 'escada' : n === 3 ? 'tercina' : `${n}/tempo`)

export function RhythmHistory({
  sessions,
  currentExercise,
  onDelete,
}: {
  sessions: RhythmSession[]
  currentExercise: string
  onDelete: (id: string) => void
}) {
  // Exercícios que já têm sessão, na ordem do seletor.
  const withSessions = useMemo(() => {
    const ids = new Set(sessions.map((s) => s.exerciseId))
    const known = EXERCISES.filter((e) => ids.has(e.id)).map((e) => ({ id: e.id, name: e.name }))
    const extra = [...ids].filter((id) => !EXERCISES.some((e) => e.id === id)).map((id) => ({ id, name: sessions.find((s) => s.exerciseId === id)!.exerciseName }))
    return [...known, ...extra]
  }, [sessions])
  const [picked, setPicked] = useState<string | null>(null)
  const chosen = picked && withSessions.some((e) => e.id === picked) ? picked : withSessions.some((e) => e.id === currentExercise) ? currentExercise : withSessions[0]?.id
  const [showAll, setShowAll] = useState(false)
  const recent = [...sessions].reverse()
  const shown = showAll ? recent : recent.slice(0, 10)

  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel/80 p-3 backdrop-blur sm:p-6">
      <h2 className="font-display text-xl font-bold">Histórico</h2>
      {!sessions.length ? (
        <p className="mt-2 text-sm text-slate-400">
          Cada gravação analisada fica guardada aqui, só neste aparelho. Grave uma sessão para começar.
        </p>
      ) : (
        <>
          <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-300">
            Evolução do exercício
            <select
              value={chosen}
              onChange={(e) => setPicked(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 py-1 text-white"
            >
              {withSessions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          {chosen && <ProgressChart sessions={sessions} exerciseId={chosen} />}

          <h3 className="mt-4 mb-2 text-sm font-semibold text-slate-200">Sessões anteriores ({sessions.length})</h3>
          <ul className="divide-y divide-line text-sm">
            {shown.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2">
                <span
                  className={`w-12 shrink-0 text-right font-display text-lg font-bold tabular-nums ${s.hitPct >= 90 ? 'text-emerald-300' : s.hitPct >= 60 ? 'text-amber-200' : 'text-rose-300'}`}
                >
                  {Math.round(s.hitPct)}%
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-slate-200">
                    {s.exerciseName} · {s.bpm} BPM · {npsLabel(s.nps)}
                    {s.tags?.length ? ` · ${s.tags.join(', ')}` : ''}
                  </span>
                  <span className="block text-xs text-slate-500 tabular-nums">
                    {fmtDate(s.date)} · x = {s.tolerance} ms · média {s.meanAbs.toFixed(0)} ms · mediana {s.medianAbs.toFixed(0)} ms · {s.n} ataques
                  </span>
                </span>
                <button
                  onClick={() => onDelete(s.id)}
                  className="btn btn-round h-8 w-8 shrink-0 p-0 text-xs"
                  aria-label={`Apagar a sessão de ${fmtDate(s.date)}`}
                  title="Apagar esta sessão"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          {recent.length > 10 && (
            <button onClick={() => setShowAll(!showAll)} className="mt-2 text-xs text-slate-400 underline">
              {showAll ? 'Mostrar só as 10 últimas' : `Mostrar todas (${recent.length})`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

function ProgressChart({ sessions, exerciseId }: { sessions: RhythmSession[]; exerciseId: string }) {
  const K = useTheme().chart
  const days = useMemo(() => dailyProgress(sessions, exerciseId), [sessions, exerciseId])
  const ref = useRef<HTMLCanvasElement>(null)
  const draw = useCallback(() => {
    const c = ref.current
    if (!c) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = c.clientWidth
    const h = c.clientHeight
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    g.font = '10px Inter Variable, sans-serif'
    const left = 32
    const bottom = h - 18
    const n = days.length
    const x = (i: number) => (n === 1 ? (left + w - 10) / 2 : left + (i / (n - 1)) * (w - left - 14))
    const y = (pct: number) => 10 + ((100 - pct) / 100) * (bottom - 10)
    g.fillStyle = K.axis
    for (const v of [0, 50, 90, 100]) {
      g.strokeStyle = v === 90 ? 'rgba(52,211,153,0.35)' : K.grid
      g.beginPath()
      g.moveTo(left, y(v))
      g.lineTo(w - 6, y(v))
      g.stroke()
      g.fillText(`${v}%`, 2, y(v) + 3)
    }
    g.strokeStyle = K.line
    g.lineWidth = 2
    g.beginPath()
    days.forEach((d, i) => (i ? g.lineTo(x(i), y(d.hitPct)) : g.moveTo(x(i), y(d.hitPct))))
    g.stroke()
    g.lineWidth = 1
    const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((w - left) / 48))))
    days.forEach((d, i) => {
      g.fillStyle = d.hitPct >= 90 ? OK_COLOR : K.line
      g.beginPath()
      g.arc(x(i), y(d.hitPct), 3.5, 0, Math.PI * 2)
      g.fill()
      if (i % labelEvery === 0 || i === n - 1) {
        g.fillStyle = K.axis
        const label = fmtDay(d.day)
        g.fillText(label, Math.max(left, Math.min(w - 30, x(i) - 12)), h - 4)
      }
    })
  }, [K, days])
  useEffect(() => {
    draw()
    const ro = new ResizeObserver(draw)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [draw])
  const last = days[days.length - 1]
  return (
    <div className="mt-2">
      <canvas ref={ref} className="h-40 w-full rounded-xl bg-black/30" aria-label="Porcentagem de acerto por dia deste exercício" />
      {last && (
        <p className="mt-1 text-xs text-slate-500">
          {days.length} {days.length === 1 ? 'dia' : 'dias'} de treino. Cada ponto é a média do dia. Último dia: {Math.round(last.hitPct)}% em{' '}
          {last.sessions} {last.sessions === 1 ? 'sessão' : 'sessões'} (até {last.bpmMax} BPM).
        </p>
      )}
    </div>
  )
}
