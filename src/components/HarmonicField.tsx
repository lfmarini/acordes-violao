import { chordDisplayName, type ChordRef } from '../lib/chords'
import { harmonicField, keyInfo, type Mode } from '../lib/harmony'

interface Props {
  chord: ChordRef
  mode: Mode
  onMode: (m: Mode) => void
  onPick: (c: ChordRef) => void
}

// Os 7 acordes do campo harmônico da tonalidade do acorde escolhido.
export function HarmonicField({ chord, mode, onMode, onPick }: Props) {
  const field = harmonicField(chord.root, mode)
  const info = keyInfo(chord.root, mode)
  return (
    <section className="rounded-2xl border border-line bg-panel/80 p-4 backdrop-blur sm:p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-display text-xl font-bold">Campo harmônico</h2>
        <div className="flex rounded-full border border-line p-0.5 text-xs" role="group" aria-label="Tonalidade">
          {(['major', 'minor'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => onMode(m)}
              aria-pressed={mode === m}
              className={`rounded-full px-3 py-1 transition ${mode === m ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {m === 'major' ? 'maior' : 'menor'}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-sm text-slate-400">
        Tom de <strong className="text-slate-200">{info.tonic} {mode === 'major' ? 'maior' : 'menor'}</strong> · {info.signature} ·
        relativo {info.relative}
      </p>

      <ol className="space-y-1.5">
        {field.map((f, i) => {
          const isCurrent = i === 0
          return (
            <li key={i}>
              <button
                disabled={!f.triad}
                onClick={() => f.triad && onPick(f.triad)}
                title={f.triad ? `Ver ${chordDisplayName(f.triad)}` : 'Sem formas no banco'}
                className={`grid w-full grid-cols-[3.2rem_1fr_auto] items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${
                  isCurrent ? 'border-accent/60 bg-accent/15' : 'border-white/5 bg-white/[0.02] hover:border-slate-500'
                }`}
              >
                <span className="font-display text-lg font-bold text-accent-2">{f.numeral}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold capitalize text-slate-200">{f.name}</span>
                  <span className="block text-xs text-slate-500">com sétima: {f.tetrad ? chordDisplayName(f.tetrad) : '—'}</span>
                </span>
                <span className="font-display text-2xl font-bold text-white">{f.triad ? chordDisplayName(f.triad) : '—'}</span>
              </button>
            </li>
          )
        })}
      </ol>
      {mode === 'minor' && (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Na escala menor natural o 7º grau fica um tom abaixo da tônica, por isso se chama <strong className="text-slate-400">subtônica</strong>.
          A sensível (meio tom abaixo) aparece na menor harmônica.
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500">Toque num acorde para vê-lo no braço.</p>
    </section>
  )
}
