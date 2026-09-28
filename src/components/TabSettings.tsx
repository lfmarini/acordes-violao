import { useMemo } from 'react'
import type { Sheet, SongTab } from '../lib/song'
import { useStoredState } from '../lib/storage'
import { mapSections, pickTrack, scoreFor, stringedTracks, type TabViewMode } from '../lib/tabScore'

// ---------------------------------------------------------------------------
// Ajustes da tablatura importada. Tudo já vem escolhido pelo app (faixa e
// onde cada trecho começa); aqui você só confere e corrige se precisar.
// Carregado só quando a música tem tablatura.
// ---------------------------------------------------------------------------

interface Props {
  tab: SongTab
  sheet: Sheet
  onChange: (tab: SongTab | undefined) => void
}

const VIEWS: { v: TabViewMode; label: string }[] = [
  { v: 'tab', label: 'Tablatura' },
  { v: 'partitura', label: 'Partitura' },
  { v: 'ambas', label: 'As duas' },
]

export default function TabSettings({ tab, sheet, onChange }: Props) {
  const [view, setView] = useStoredState<TabViewMode>('musik-tab-visual', 'ambas')
  const score = useMemo(() => {
    try {
      return scoreFor(tab)
    } catch {
      return null
    }
  }, [tab])
  const parts = useMemo(() => (score ? mapSections(score, sheet, tab.shifts) : []), [score, sheet, tab.shifts])
  if (!score) return <p className="text-sm text-rose-300">Não consegui ler "{tab.name}". O arquivo pode estar danificado.</p>
  const tracks = stringedTracks(score)
  const auto = pickTrack(score, parts)
  const track = tab.track ?? auto
  const shift = (key: string, d: number) => onChange({ ...tab, shifts: { ...tab.shifts, [key]: (tab.shifts[key] ?? 0) + d } })

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-slate-300">
          Faixa
          <select
            value={track}
            onChange={(e) => onChange({ ...tab, track: Number(e.target.value) === auto ? undefined : Number(e.target.value) })}
            className="max-w-[14rem] rounded-lg border border-line bg-panel px-2 py-1 text-white"
          >
            {tracks.map((t) => (
              <option key={t.index} value={t.index}>
                {t.name}
                {t.index === auto ? ' (automática)' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-1 rounded-full border border-line bg-panel/70 p-1 text-xs" role="group" aria-label="Como mostrar">
          {VIEWS.map((o) => (
            <button
              key={o.v}
              onClick={() => setView(o.v)}
              aria-pressed={view === o.v}
              className={`rounded-full px-3 py-1 font-semibold ${view === o.v ? 'bg-accent text-[#fff]' : 'text-slate-400'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {parts.length ? (
        <ul className="flex flex-col gap-1">
          {parts.map((p) => (
            <li key={p.key} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
              <strong className="w-16 font-display">{p.label}</strong>
              <span>
                começa no compasso <strong className="text-white tabular-nums">{p.startBar + 1}</strong> da tablatura
                <span className="text-slate-500"> ({p.how === 'marcação' ? `marcação "${p.marker}"` : 'pela contagem'})</span>
              </span>
              <span className="ml-auto flex gap-1">
                <button onClick={() => shift(p.key, -1)} className="btn btn-round h-7 w-7 p-0" aria-label={`${p.label}: um compasso antes`}>
                  ◀
                </button>
                <button onClick={() => shift(p.key, 1)} className="btn btn-round h-7 w-7 p-0" aria-label={`${p.label}: um compasso depois`}>
                  ▶
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-amber-200">Esta música não tem trechos INTRO, SOLO ou FINAL; a tablatura fica guardada para quando tiver.</p>
      )}
      <button onClick={() => confirm(`Tirar a tablatura "${tab.name}" desta música?`) && onChange(undefined)} className="self-start text-xs text-slate-400 underline hover:text-rose-300">
        tirar a tablatura
      </button>
    </div>
  )
}
