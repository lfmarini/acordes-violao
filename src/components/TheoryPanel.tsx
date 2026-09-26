import { motion } from 'framer-motion'
import { Note } from 'tonal'
import { chordDisplayName, type ChordRef } from '../lib/chords'
import { DEGREES, describeInterval, type Analysis } from '../lib/theory'

interface Props {
  chord: ChordRef
  analysis: Analysis
  highlight: number | null
  onHighlight: (chroma: number | null) => void
}

// Painel com cada grau do acorde. A cor de cada linha é a mesma dos círculos
// no braço; passar o mouse (ou tocar) numa linha destaca a nota no braço.
export function TheoryPanel({ chord, analysis, highlight, onHighlight }: Props) {
  return (
    <aside className="rounded-2xl border border-line bg-panel/80 p-4 backdrop-blur sm:p-5">
      <h2 className="font-display text-xl font-bold">
        Teoria de <span className="text-accent-2">{chordDisplayName(chord)}</span>
      </h2>
      <p className="mb-4 text-sm text-slate-400">
        {chord.root} {chord.quality.name} · notas: {analysis.members.map((m) => m.note).join(' – ')}
      </p>

      <ul className="space-y-2">
        {analysis.rows.map((row) => {
          const d = DEGREES[row.degree]
          if (row.present.length === 0) {
            // Grau ausente: mostramos em cinza qual nota ele seria.
            return (
              <li key={row.degree} className="flex items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2.5 opacity-60">
                <span className="h-4 w-4 shrink-0 rounded-full border-2 border-slate-600" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-400">{d.name}</div>
                  <div className="text-xs text-slate-500">
                    seria {row.missing.map((m) => `${m.note} (${describeInterval(m.interval)})`).join(' ou ')}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-500">
                  não presente neste acorde
                </span>
              </li>
            )
          }
          return row.present.map((m) => {
            const chroma = Note.chroma(m.note) ?? -1
            const on = highlight === chroma
            return (
              <motion.li
                key={row.degree + m.note}
                layout
                tabIndex={0}
                onMouseEnter={() => onHighlight(chroma)}
                onMouseLeave={() => onHighlight(null)}
                onFocus={() => onHighlight(chroma)}
                onBlur={() => onHighlight(null)}
                onClick={() => onHighlight(on ? null : chroma)}
                className="flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 outline-none transition"
                style={{
                  borderColor: on ? d.color : 'rgba(255,255,255,0.08)',
                  background: on ? `${d.color}22` : 'rgba(255,255,255,0.02)',
                }}
              >
                <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: d.color, boxShadow: `0 0 12px ${d.color}88` }} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold" style={{ color: d.color }}>
                    {d.name}
                  </div>
                  <div className="text-xs text-slate-400">{describeInterval(m.interval)}</div>
                </div>
                <span className="font-display text-2xl font-bold text-white">{m.note}</span>
              </motion.li>
            )
          })
        })}
      </ul>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        * A <strong className="text-slate-400">nona</strong> é a mesma nota da <strong className="text-slate-400">segunda</strong>,
        só que uma oitava acima (2 + 7 = 9). Em {chord.root}, a segunda e a nona são ambas{' '}
        {Note.pitchClass(Note.transpose(chord.root, '9M'))}.
      </p>
      <p className="mt-2 text-xs text-slate-500">Passe o mouse ou toque num grau para ver onde essa nota está no braço.</p>
    </aside>
  )
}
