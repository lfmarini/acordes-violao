import { useMemo } from 'react'
import type { TakeAnalysis } from '../lib/rhythmAnalysis'
import { delayStats, type DelayStats } from '../lib/rhythmStats'
import { DelayHistogram, DelayTimeline, WaveformView } from './RhythmCharts'

// ---------------------------------------------------------------------------
// Resultado de uma gravação do treino de ritmo: % de acerto dentro da
// tolerância x, média, mediana, desvio padrão, média com sinal, avisos
// (beats sem ataque, ataques extras) e os gráficos. Mudar x, a sensibilidade
// ou o ajuste de latência recalcula na hora, sem regravar.
// ---------------------------------------------------------------------------

export const TOLERANCE_DEFAULT = 30

interface Props {
  samples: Float32Array
  sampleRate: number
  analysis: TakeAnalysis | null
  analyzing: boolean
  tolerance: number
  onTolerance: (v: number) => void
  sensitivity: number
  onSensitivity: (v: number) => void
  /** Latência automática (ms) informada pelo navegador. */
  autoLatencyMs: number
  latencyAdjust: number
  onLatencyAdjust: (v: number) => void
  offbeat?: boolean
}

const ms = (v: number, digits = 1) => `${v.toFixed(digits).replace('.', ',')} ms`
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${ms(Math.abs(v))}`

export function RhythmResults(p: Props) {
  const { analysis, tolerance } = p
  const delays = useMemo(() => analysis?.matching.hits.map((h) => h.delay) ?? [], [analysis])
  const st = useMemo(() => delayStats(delays, tolerance), [delays, tolerance])
  const split = useMemo(() => {
    const hits = analysis?.matching.hits ?? []
    if (!hits.some((h) => h.muted)) return null
    return {
      on: delayStats(
        hits.filter((h) => !h.muted).map((h) => h.delay),
        tolerance,
      ),
      off: delayStats(
        hits.filter((h) => h.muted).map((h) => h.delay),
        tolerance,
      ),
    }
  }, [analysis, tolerance])

  if (!analysis) {
    return (
      <div className="mt-4 rounded-xl border border-line bg-black/20 p-4 text-center text-sm text-slate-400">
        {p.analyzing ? 'Analisando a gravação…' : 'Sem resultado ainda.'}
      </div>
    )
  }
  const m = analysis.matching
  const ignored = analysis.onsets.filter((o) => o.click).length
  const tendency =
    st.n === 0 ? '' : Math.abs(st.meanSigned) < 3 ? 'no tempo, em média' : st.meanSigned < 0 ? 'você tende a adiantar' : 'você tende a atrasar'

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border border-line bg-black/20 p-3 sm:p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs tracking-wide text-slate-400 uppercase">Acerto</div>
            <div className={`font-display text-5xl font-bold tabular-nums ${st.hitPct >= 90 ? 'text-emerald-300' : st.hitPct >= 60 ? 'text-amber-200' : 'text-rose-300'}`}>
              {st.n ? `${Math.round(st.hitPct)}%` : '—'}
            </div>
            <div className="text-xs text-slate-400">
              {st.n} {st.n === 1 ? 'ataque medido' : 'ataques medidos'} · |d3lay| ≤ {tolerance} ms
              {p.analyzing && ' · recalculando…'}
            </div>
          </div>
          <ToleranceField value={tolerance} onChange={p.onTolerance} />
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Stat label="Média |d3lay|" value={st.n ? ms(st.meanAbs) : '—'} />
          <Stat label="Mediana |d3lay|" value={st.n ? ms(st.medianAbs) : '—'} />
          <Stat label="Desvio padrão" value={st.n ? ms(st.sd) : '—'} />
          <Stat label="Média com sinal" value={st.n ? signed(st.meanSigned) : '—'} hint={tendency} />
        </dl>

        <ul className="mt-3 space-y-1 text-xs">
          <li className="text-slate-400">
            Beats sem ataque: <strong className="text-slate-200">{m.missed}</strong> <span className="text-slate-500">(não entram nas contas)</span>
          </li>
          {m.extras.length > 0 && (
            <li className="text-amber-200">
              ⚠ Ataques extras: <strong>{m.extras.length}</strong> (mais de um ataque no mesmo ponto; vale o mais próximo)
            </li>
          )}
          {ignored > 0 && (
            <li className="text-slate-400">
              Cliques do metrônomo ignorados: <strong className="text-slate-200">{ignored}</strong> (o microfone captou o clique; use fone)
            </li>
          )}
          {m.outside > 0 && (
            <li className="text-slate-500">
              Ataques fora da grade (na contagem ou depois do fim): {m.outside}
            </li>
          )}
          <li className="text-slate-500">
            Negativo = adiantado; positivo = atrasado{p.offbeat ? '. Alvo: o meio de cada divisão (contratempo).' : '.'}
          </li>
        </ul>

        {split && (
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="py-1 font-normal">Trechos</th>
                <th className="py-1 font-normal">Acerto</th>
                <th className="py-1 font-normal">Média |d|</th>
                <th className="py-1 font-normal">Com sinal</th>
                <th className="py-1 font-normal">Ataques</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-slate-200">
              <SplitRow label="Com clique" s={split.on} />
              <SplitRow label="Sem clique" s={split.off} />
            </tbody>
          </table>
        )}
      </div>

      {st.n > 0 && (
        <>
          <Card title="Histograma do d3lay" hint="Faixas de 5 ms. Verde: dentro de ±x.">
            <DelayHistogram delays={delays} tolerance={tolerance} />
          </Card>
          <Card title="Ao longo da gravação" hint="Cada ponto é um ataque. A faixa verde é ±x.">
            <DelayTimeline hits={m.hits} tolerance={tolerance} start={analysis.grid[0]?.time ?? 0} />
          </Card>
        </>
      )}

      <Card title="Conferir a detecção" hint="Arraste para o lado para ver outro trecho. Cada triângulo é um ataque detectado.">
        <WaveformView samples={p.samples} sampleRate={p.sampleRate} analysis={analysis} tolerance={tolerance} />
        <div className="mt-3 grid gap-3 text-xs text-slate-300 sm:grid-cols-2">
          <label className="block">
            Sensibilidade: <strong className="tabular-nums">{p.sensitivity}</strong>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={p.sensitivity}
              onChange={(e) => p.onSensitivity(Number(e.target.value))}
              aria-label="Sensibilidade da detecção de ataques"
              className="mt-1 block w-full accent-[var(--color-accent)]"
            />
            <span className="text-slate-500">Faltou ataque? Aumente. Apareceu ataque que não existe? Diminua.</span>
          </label>
          <LatencyField auto={p.autoLatencyMs} adjust={p.latencyAdjust} onAdjust={p.onLatencyAdjust} />
        </div>
      </Card>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-black/25 px-3 py-2">
      <dt className="text-[11px] text-slate-400">{label}</dt>
      <dd className="font-display text-lg font-semibold tabular-nums text-white">{value}</dd>
      {hint && <dd className="text-[11px] text-slate-400">{hint}</dd>}
    </div>
  )
}

function SplitRow({ label, s }: { label: string; s: DelayStats }) {
  return (
    <tr className="border-t border-line">
      <td className="py-1 text-slate-400">{label}</td>
      <td className="py-1">{s.n ? `${Math.round(s.hitPct)}%` : '—'}</td>
      <td className="py-1">{s.n ? ms(s.meanAbs) : '—'}</td>
      <td className="py-1">{s.n ? signed(s.meanSigned) : '—'}</td>
      <td className="py-1">{s.n}</td>
    </tr>
  )
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-black/20 p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-semibold text-slate-200">{title}</h3>
        {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

export function ToleranceField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.max(1, Math.min(200, Math.round(v))))
  return (
    <div className="flex items-center gap-2 text-sm text-slate-300">
      <span>Tolerância x</span>
      <button onClick={() => set(value - 5)} className="btn btn-round h-9 w-9 p-0" aria-label="Diminuir a tolerância em 5 ms">
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={200}
        value={value}
        onChange={(e) => e.target.value !== '' && set(Number(e.target.value))}
        aria-label="Tolerância em milissegundos"
        className="w-16 rounded-lg border border-line bg-transparent px-2 py-1 text-center text-base text-white tabular-nums"
      />
      <button onClick={() => set(value + 5)} className="btn btn-round h-9 w-9 p-0" aria-label="Aumentar a tolerância em 5 ms">
        +
      </button>
      <span>ms</span>
    </div>
  )
}

export function LatencyField({ auto, adjust, onAdjust }: { auto: number; adjust: number; onAdjust: (v: number) => void }) {
  return (
    <label className="block">
      Ajuste de latência (ms)
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          step={1}
          value={adjust}
          onChange={(e) => e.target.value !== '' && onAdjust(Math.max(-500, Math.min(500, Math.round(Number(e.target.value)))))}
          aria-label="Ajuste de latência em milissegundos"
          className="w-20 rounded-lg border border-line bg-transparent px-2 py-1 text-center text-base text-white tabular-nums"
        />
        <span className="text-slate-500">
          + automática {Math.round(auto)} ms = <strong className="text-slate-300">{Math.round(auto + adjust)} ms</strong>
        </span>
      </div>
      <span className="text-slate-500">Se todos os ataques aparecem atrasados (ou adiantados) pelo mesmo tanto, é a latência: use a calibração.</span>
    </label>
  )
}
