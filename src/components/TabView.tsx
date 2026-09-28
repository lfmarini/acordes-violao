import { useEffect, useMemo, useRef, useState } from 'react'
import type { Section, Sheet, SongTab } from '../lib/song'
import type { PlayPos } from '../lib/songPlayer'
import { useStoredState } from '../lib/storage'
import { mapSections, pickTrack, renderSection, scoreFor, type TabApi, type TabViewMode } from '../lib/tabScore'
import { useTheme } from '../lib/themes'

// ---------------------------------------------------------------------------
// Tablatura/partitura de um trecho INTRO, SOLO ou FINAL, desenhada pelo
// alphaTab. Durante o karaokê, o compasso atual ganha um fundo e uma linha
// vertical anda pelo tempo do compasso. Carregado só quando há tablatura.
// ---------------------------------------------------------------------------

type Box = { x: number; y: number; w: number; h: number }

interface Props {
  tab: SongTab
  sheet: Sheet
  section: Section
  now?: PlayPos | null
}

export default function TabView({ tab, sheet, section, now }: Props) {
  const theme = useTheme()
  const [view] = useStoredState<TabViewMode>('musik-tab-visual', 'ambas')
  const host = useRef<HTMLDivElement>(null)
  // Posição (na tela) de cada compasso do trecho, lida quando o alphaTab termina de desenhar.
  const [boxes, setBoxes] = useState<(Box | null)[]>([])
  const [error, setError] = useState('')

  const score = useMemo(() => {
    try {
      return scoreFor(tab)
    } catch {
      return null
    }
  }, [tab])
  const all = useMemo(() => (score ? mapSections(score, sheet, tab.shifts) : []), [score, sheet, tab.shifts])
  const part = all.find((s) => s.measures[0] === section.measures[0]?.index)
  const track = score ? (tab.track ?? pickTrack(score, all)) : 0

  useEffect(() => {
    const el = host.current
    if (!el || !score || !part) return
    let a: TabApi
    try {
      a = renderSection(el, score, {
        track,
        startBar: part.startBar,
        barCount: part.barCount,
        view,
        colors: { text: theme.ui.text, sub: theme.board.sub, line: theme.ui.line },
      })
    } catch (e) {
      console.error('Tablatura:', e) // raro: o erro de desenho normalmente chega pelo evento abaixo
      return
    }
    a.error.on(() => setError('Não consegui desenhar esta tablatura.'))
    a.renderFinished.on(() => {
      setError('')
      const look = a.renderer.boundsLookup
      setBoxes(
        Array.from({ length: part.barCount }, (_, i) => {
          const b = look?.findMasterBarByIndex(part.startBar + i)?.realBounds
          return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null
        }),
      )
    })
    return () => a.destroy()
  }, [score, track, part?.startBar, part?.barCount, view, theme]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!score) return <p className="text-sm text-rose-300">Não consegui ler o arquivo de tablatura "{tab.name}".</p>
  if (!part) return null

  // Compasso da tablatura que está tocando e onde a linha do tempo fica nele.
  const k = now ? part.measures.indexOf(now.measure) : -1
  const m = k >= 0 ? sheet.measures[now!.measure] : null
  const frac = m && now ? (Math.max(0, now.beat) + 0.5) / Math.max(1, m.beats.length) : 0
  const bounds = k >= 0 ? boxes[k] : null

  return (
    <div className="mt-2">
      <p className="mb-1 text-[11px] text-slate-500">
        {tab.name} · compasso {part.startBar + 1}
        {part.barCount > 1 ? `–${part.startBar + part.barCount}` : ''} ({part.how === 'marcação' ? `marcação "${part.marker}"` : 'pela contagem'})
      </p>
      <div className="relative overflow-x-auto rounded-lg bg-white/[0.03]">
        <div ref={host} />
        {bounds && (
          <>
            <span
              className="pointer-events-none absolute rounded bg-accent-2/15 transition-all"
              style={{ left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h }}
              aria-hidden
            />
            <span
              className="pointer-events-none absolute w-0.5 rounded-full bg-accent-2 transition-all"
              style={{ left: bounds.x + bounds.w * frac, top: bounds.y, height: bounds.h }}
              aria-hidden
            />
          </>
        )}
      </div>
      {error && <p className="mt-1 text-sm text-rose-300">{error}</p>}
    </div>
  )
}
