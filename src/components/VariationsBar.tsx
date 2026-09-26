import { useEffect, useRef } from 'react'
import type { Shape } from '../lib/chords'
import type { Analysis } from '../lib/theory'
import { Fretboard } from './Fretboard'

interface Props {
  shapes: Shape[]
  active: number
  analysis: Analysis
  lefty: boolean
  onSelect: (index: number) => void
}

// Miniaturas de todas as formas do acorde, lado a lado.
export function VariationsBar({ shapes, active, analysis, lefty, onSelect }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const track = useRef<HTMLDivElement>(null)

  // Mantém a miniatura ativa sempre visível quando a barra rola (celular).
  // Rolamos só a barra, na horizontal, sem mexer na rolagem da página.
  useEffect(() => {
    const el = refs.current[active]
    const box = track.current
    if (!el || !box) return
    box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' })
  }, [active, shapes])

  if (shapes.length < 2) return null

  return (
    <nav aria-label="Variações do acorde" className="w-full">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
        <span>Variações ({shapes.length})</span>
        <span className="hidden sm:inline">use ← → no teclado</span>
      </div>
      <div ref={track} className="scroll-thin relative flex snap-x gap-2 overflow-x-auto pb-2">
        {shapes.map((s, i) => (
          <button
            key={i}
            ref={(el) => {
              refs.current[i] = el
            }}
            onClick={() => onSelect(i)}
            aria-pressed={i === active}
            aria-label={`Variação ${i + 1}: ${s.label}`}
            className={`flex w-[84px] shrink-0 snap-center flex-col items-center rounded-xl border p-1.5 transition ${
              i === active
                ? 'border-accent-2 bg-accent-2/10 shadow-lg shadow-accent-2/20'
                : 'border-line bg-panel/60 hover:border-slate-500'
            }`}
          >
            <Fretboard shape={s} analysis={analysis} lefty={lefty} mini className="w-full" />
            <span className={`mt-1 text-xs font-medium ${i === active ? 'text-accent-2' : 'text-slate-300'}`}>
              {s.label}
            </span>
          </button>
        ))}
      </div>
    </nav>
  )
}
