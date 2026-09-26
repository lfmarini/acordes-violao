import { useId, useMemo, useState } from 'react'
import { QUALITIES, ROOTS, chordDisplayName, type ChordRef } from '../lib/chords'
import { parseChord, suggest } from '../lib/parser'
import { Note } from 'tonal'

interface Props {
  chord: ChordRef
  onChange: (c: ChordRef) => void
}

// Duas formas de escolher: lista (tônica + qualidade) e caixa de texto.
export function ChordPicker({ chord, onChange }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const listId = useId()

  const suggestions = useMemo(() => suggest(text), [text])
  const rootChroma = Note.chroma(chord.root)

  const submit = (value: string) => {
    const r = parseChord(value)
    if (r.ok) {
      onChange(r.chord)
      setError(null)
      setText('')
      setOpen(false)
    } else {
      setError(r.error)
    }
  }

  const pick = (c: ChordRef) => {
    onChange(c)
    setText('')
    setError(null)
    setOpen(false)
  }

  return (
    <section className="space-y-3">
      {/* Caixa de texto com autocompletar */}
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault()
          // Se o usuário navegou pelas sugestões com as setas, vale a sugestão;
          // senão, vale exatamente o que foi digitado.
          if (open && cursor > 0 && suggestions[cursor]) pick(suggestions[cursor])
          else if (parseChord(text).ok || !suggestions[0]) submit(text)
          else pick(suggestions[0])
        }}
      >
        <label htmlFor={`${listId}-in`} className="sr-only">
          Digite um acorde
        </label>
        <input
          id={`${listId}-in`}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
            setCursor(0)
            setError(null)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, suggestions.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="Digite um acorde: Am7, C7M, D°..."
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={`${listId}-list`}
          aria-invalid={!!error}
          className="w-full rounded-xl border border-line bg-panel/80 px-4 py-3 text-base text-white placeholder:text-slate-500 focus:border-accent focus:outline-none"
        />
        {open && suggestions.length > 0 && (
          <ul
            id={`${listId}-list`}
            role="listbox"
            className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-panel shadow-2xl"
          >
            {suggestions.map((s, i) => (
              <li
                key={chordDisplayName(s) + s.quality.id}
                role="option"
                aria-selected={i === cursor}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(s)
                }}
                className={`flex cursor-pointer items-baseline justify-between px-4 py-2 ${
                  i === cursor ? 'bg-accent/25' : 'hover:bg-white/5'
                }`}
              >
                <span className="font-display text-lg font-semibold">{chordDisplayName(s)}</span>
                <span className="text-xs text-slate-400">{s.quality.name}</span>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        )}
      </form>

      {/* Lista: primeiro a tônica... */}
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
        {ROOTS.map((r) => {
          const active = Note.chroma(r.name) === rootChroma
          return (
            <button
              key={r.name}
              onClick={() => onChange({ root: r.name, quality: chord.quality })}
              className={`rounded-lg px-1 py-2 font-display text-sm font-semibold transition ${
                active ? 'bg-accent text-white shadow-lg shadow-accent/30' : 'bg-white/5 text-slate-200 hover:bg-white/10'
              }`}
              aria-pressed={active}
            >
              {r.label}
            </button>
          )
        })}
      </div>

      {/* ...depois a qualidade */}
      <div className="scroll-thin -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {QUALITIES.map((q) => {
          const active = q.id === chord.quality.id
          return (
            <button
              key={q.id}
              onClick={() => onChange({ root: chord.root, quality: q })}
              title={q.name}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition ${
                active
                  ? 'border-accent-2 bg-accent-2/15 text-accent-2'
                  : 'border-line text-slate-300 hover:border-slate-500'
              }`}
              aria-pressed={active}
            >
              {q.br === '' ? 'maior' : q.br}
            </button>
          )
        })}
      </div>
    </section>
  )
}
