import { useEffect, useRef, useState } from 'react'
import { playShapeWithPrefs } from '../lib/audio'
import { QUALITIES } from '../lib/chords'
import { chordAt, type Measure, type MeasureChord, type Section, type Sheet, type Song } from '../lib/song'
import type { PlayPos } from '../lib/songPlayer'
import { shapeForSongChord, songChordName, toChordRef, type SongChord } from '../lib/songChords'
import { useStoredState } from '../lib/storage'
import { analyze } from '../lib/theory'
import { ChordPicker } from './ChordPicker'
import { Fretboard } from './Fretboard'

// ---------------------------------------------------------------------------
// Página da música montada: tabela de acordes (fixa no topo), série de
// acordes por seção e a letra em blocos de compasso (ou "letra corrida").
// `now` (compasso e tempo tocando agora) acende os blocos durante o karaokê.
// ---------------------------------------------------------------------------

interface Props {
  song: Song
  sheet: Sheet
  now?: PlayPos | null
  onEditMeasure: (index: number, chords: MeasureChord[] | null) => void
  onShiftDownbeat: (delta: number) => void
  onSeek?: (measure: number) => void
}

const playChord = (c: SongChord | null) => {
  const s = c && shapeForSongChord(c)
  if (s) playShapeWithPrefs(s)
}

export function SongSheet({ song, sheet, now, onEditMeasure, onShiftDownbeat, onSeek }: Props) {
  const [flow, setFlow] = useStoredState('musik-letra-corrida', false)
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const currentChord = now ? chordAt(sheet.measures[now.measure], now.beat) : null
  const root = useRef<HTMLDivElement>(null)
  const lastLine = useRef<Element | null>(null)

  // Karaokê: quando a linha muda, rola a página para ela ficar no meio da tela.
  useEffect(() => {
    if (!now || !root.current) return
    const el =
      root.current.querySelector(`[data-measure="${now.measure}"]`) ??
      [...root.current.querySelectorAll<HTMLElement>('[data-measures]')].find((x) => {
        const [a, b] = x.dataset.measures!.split('-').map(Number)
        return now.measure >= a && now.measure <= b
      })
    const line = el?.closest('[data-line]') ?? el
    if (!line || line === lastLine.current) return
    lastLine.current = line
    line.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [now])

  const select = (i: number) => (editing ? setSelected(i) : onSeek?.(i))

  return (
    <div ref={root} className="flex flex-col gap-4">
      <ChordTable chords={sheet.chordsInOrder} current={currentChord} />

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-sm text-amber-200">
        <span className="font-semibold">⚠ Montado automaticamente — revise.</span>
        <span className="text-xs text-amber-200/80">Os acordes vêm de {sourceName(song)}; a letra, do LRCLIB.</span>
        <button
          onClick={() => {
            setEditing(!editing)
            setSelected(null)
          }}
          aria-pressed={editing}
          className={`btn btn-round ml-auto px-3 py-1 text-xs ${editing ? 'btn-primary' : ''}`}
        >
          ✎ {editing ? 'Concluir edição' : 'Editar compassos'}
        </button>
      </div>
      {sheet.warnings.map((w) => (
        <p key={w} className="rounded-xl border border-rose-300/40 bg-rose-300/10 px-3 py-2 text-sm text-rose-200">
          {w}
        </p>
      ))}

      {editing && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel/80 px-3 py-2 text-sm text-slate-300">
          <span>Toque num bloco para corrigir o acorde. Divisão dos compassos:</span>
          <button onClick={() => onShiftDownbeat(-1)} className="btn btn-round px-3 py-1 text-xs" aria-label="Começar o compasso uma batida antes">
            ◀ 1 tempo
          </button>
          <button onClick={() => onShiftDownbeat(1)} className="btn btn-round px-3 py-1 text-xs" aria-label="Começar o compasso uma batida depois">
            1 tempo ▶
          </button>
        </div>
      )}

      <ChordSeries sheet={sheet} now={now} />

      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold">Letra e compassos</h3>
        <div className="flex gap-1 rounded-full border border-line bg-panel/70 p-1 text-xs" role="group" aria-label="Modo de exibição">
          {[
            { v: false, label: 'Blocos' },
            { v: true, label: 'Letra corrida' },
          ].map((o) => (
            <button
              key={o.label}
              onClick={() => setFlow(o.v)}
              aria-pressed={flow === o.v}
              className={`rounded-full px-3 py-1.5 font-semibold ${flow === o.v ? 'bg-accent text-[#fff]' : 'text-slate-400'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {sheet.sections.map((sec, i) => (
          <SectionView
            key={i}
            section={sec}
            beatsPerBar={sheet.beatsPerBar}
            flow={flow}
            now={now}
            editing={editing}
            selected={selected}
            onSelect={select}
          />
        ))}
      </div>

      {editing && selected !== null && sheet.measures[selected] && (
        <EditPanel
          measure={sheet.measures[selected]}
          beatsPerBar={sheet.beatsPerBar}
          palette={sheet.chordsInOrder}
          onChange={(chords) => onEditMeasure(selected, chords)}
          onClose={() => setSelected(null)}
          onNext={() => setSelected(Math.min(selected + 1, sheet.measures.length - 1))}
        />
      )}
    </div>
  )
}

const sourceName = (s: Song) =>
  ({ midi: `o MIDI${s.midiName ? ` "${s.midiName}"` : ''}`, audio: 'a análise do áudio', mic: 'o microfone', manual: 'a cifra colada', tap: 'as suas marcações' })[
    s.source ?? 'midi'
  ] ?? 'o MIDI'

// --- Tabela de acordes ----------------------------------------------------------

function ChordTable({ chords, current }: { chords: SongChord[]; current: SongChord | null }) {
  if (!chords.length) return null
  return (
    <div className="sticky top-0 z-20 -mx-2 border-b border-line bg-ink/85 px-2 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
      <div className="scroll-thin flex gap-2 overflow-x-auto pb-1" aria-label="Acordes da música">
        {chords.map((c) => {
          const name = songChordName(c)
          const shape = shapeForSongChord(c)
          const on = current !== null && songChordName(current) === name
          return (
            <button
              key={name}
              onClick={() => playChord(c)}
              aria-label={`Tocar ${name}`}
              aria-current={on}
              className={`flex w-[76px] shrink-0 flex-col items-center rounded-xl border p-1 transition ${
                on ? 'border-accent-2 bg-accent-2/15 shadow-lg shadow-accent-2/30' : 'border-line bg-panel/70 hover:border-slate-500'
              }`}
            >
              <span className={`font-display text-lg leading-tight font-bold ${on ? 'text-accent-2' : ''}`}>{name}</span>
              {shape ? (
                <Fretboard shape={shape} analysis={analyze(toChordRef(c))} mini className="w-full" />
              ) : (
                <span className="py-6 text-[10px] text-slate-500">sem diagrama</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// --- Série de acordes -------------------------------------------------------------

function measureLabel(m: Measure) {
  const names = m.chords.map((c) => songChordName(c.chord))
  return names.length ? names.join(' ') : '%'
}

function ChordSeries({ sheet, now }: { sheet: Sheet; now?: PlayPos | null }) {
  return (
    <section className="rounded-2xl border border-line bg-panel/80 p-3 backdrop-blur sm:p-4" aria-label="Série de acordes">
      <h3 className="mb-2 font-display text-lg font-bold">Série de acordes</h3>
      <div className="flex flex-col gap-2">
        {sheet.sections.map((sec, i) => (
          <div key={i} className="flex flex-wrap items-center gap-y-1 font-display text-sm">
            <span className="mr-2 w-20 shrink-0 text-xs font-semibold text-slate-400 uppercase">{sec.label}</span>
            {sec.lines.length === 0 ? (
              <InstrumentalBadge section={sec} active={!!now && sec.measures.some((m) => m.index === now.measure)} small />
            ) : (
              <>
                <span className="text-slate-600">|</span>
                {sec.lines.flatMap((l) => l.measures).map((m) => (
                  <span key={m.index} className="flex items-center">
                    <span
                      className={`rounded px-1.5 py-0.5 font-semibold ${now?.measure === m.index ? 'bg-accent text-[#fff]' : 'text-slate-200'}`}
                    >
                      {measureLabel(m)}
                    </span>
                    <span className="text-slate-600">|</span>
                  </span>
                ))}
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function InstrumentalBadge({ section, active, small }: { section: Section; active: boolean; small?: boolean }) {
  const secs = Math.round(section.end - section.start)
  const range = section.measures.length ? `${section.measures[0].index}-${section.measures[section.measures.length - 1].index}` : undefined
  return (
    <span
      {...(small ? {} : { 'data-measures': range })}
      className={`inline-flex items-center gap-2 rounded-lg border border-dashed font-display font-bold tracking-widest ${
        small ? 'px-2 py-0.5 text-xs' : 'px-4 py-3 text-lg'
      } ${active ? 'border-accent-2 bg-accent-2/15 text-accent-2' : 'border-slate-500 text-slate-300'}`}
    >
      {section.label}
      <span className="text-[10px] font-normal tracking-normal text-slate-400">
        {section.measures.length} compassos · {secs} s
      </span>
    </span>
  )
}

// --- Seções, linhas e blocos ---------------------------------------------------------

interface SectionProps {
  section: Section
  beatsPerBar: number
  flow: boolean
  now?: PlayPos | null
  editing: boolean
  selected: number | null
  onSelect: (i: number) => void
}

function SectionView({ section, beatsPerBar, flow, now, editing, selected, onSelect }: SectionProps) {
  const active = !!now && (section.lines.length ? section.lines.some((l) => l.measures.some((m) => m.index === now.measure)) : section.measures.some((m) => m.index === now.measure))
  return (
    <section>
      <h4 className={`mb-2 font-display text-sm font-bold tracking-wider uppercase ${active ? 'text-accent-2' : 'text-slate-400'}`}>
        {section.label}
      </h4>
      {section.lines.length === 0 ? (
        // INTRO / SOLO / FINAL: por enquanto só o aviso (conteúdo virá depois).
        <InstrumentalBadge section={section} active={active} />
      ) : (
        <div className="flex flex-col gap-3">
          {section.lines.map((line, i) =>
            flow ? (
              <FlowLine key={i} measures={line.measures} now={now} onSelect={onSelect} />
            ) : (
              <div key={i} className="flex flex-wrap gap-1.5" data-line>
                {line.measures.map((m) => (
                  <MeasureBlock
                    key={m.index}
                    m={m}
                    beatsPerBar={beatsPerBar}
                    now={now}
                    editing={editing}
                    selected={selected === m.index}
                    onSelect={() => onSelect(m.index)}
                  />
                ))}
              </div>
            ),
          )}
        </div>
      )}
    </section>
  )
}

interface BlockProps {
  m: Measure
  beatsPerBar: number
  now?: PlayPos | null
  editing: boolean
  selected: boolean
  onSelect: () => void
}

function MeasureBlock({ m, beatsPerBar, now, editing, selected, onSelect }: BlockProps) {
  const on = now?.measure === m.index
  const n = Math.max(m.beats.length, 1)
  const cols = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }
  return (
    <button
      onClick={onSelect}
      {...(editing ? { 'aria-pressed': selected } : { 'aria-label': `Ir para o compasso ${m.index + 1}` })}
      data-measure={m.index}
      className={`flex min-w-[7.5rem] flex-1 basis-[7.5rem] flex-col gap-1 rounded-xl border px-2 py-1.5 text-left transition sm:max-w-[13rem] ${
        on
          ? 'border-accent-2 bg-accent-2/15 shadow-lg shadow-accent-2/25'
          : selected
            ? 'border-accent bg-accent/15'
            : 'border-line bg-panel/70'
      } ${editing ? 'hover:border-accent' : 'hover:border-slate-500'} ${n < beatsPerBar ? 'opacity-80' : ''}`}
    >
      {/* Acordes. Computador: cada um na coluna do tempo em que entra.
          Celular: lado a lado, com o número do tempo em que o 2º acorde entra. */}
      <div className="flex h-8 items-end gap-2 sm:grid sm:gap-0" style={cols}>
        {m.chords.map((c, k) => (
          <span
            key={k}
            style={{ gridColumnStart: Math.min(c.beat, n - 1) + 1 }}
            className={`font-display text-2xl leading-none font-bold whitespace-nowrap ${on ? 'text-white' : 'text-slate-100'}`}
          >
            {songChordName(c.chord)}
            {c.beat > 0 && <sup className="ml-0.5 text-[10px] font-semibold text-accent-2 sm:hidden">{c.beat + 1}</sup>}
            {m.edited && k === 0 && <span className="ml-0.5 align-top text-[10px] text-amber-300">✎</span>}
          </span>
        ))}
      </div>
      {/* Marcas dos tempos: agrupadas no celular, uma por coluna no computador.
          O anel marca o tempo em que um acorde novo entra no meio do compasso. */}
      <div className="flex items-center gap-1.5 sm:grid sm:gap-0" style={cols} aria-hidden>
        {m.beats.map((_, b) => (
          <span
            key={b}
            className={`h-2 w-2 rounded-full transition ${
              on && now!.beat === b ? 'scale-150 bg-accent-2' : on && now!.beat > b ? 'bg-accent-2/60' : b === 0 ? 'bg-slate-400' : 'bg-slate-600'
            } ${b > 0 && m.chords.some((c) => c.beat === b) ? 'ring-2 ring-accent-2/70 ring-offset-1 ring-offset-transparent' : ''}`}
          />
        ))}
      </div>
      <div className={`min-h-[1.5rem] text-base leading-snug ${on ? 'text-white' : 'text-slate-300'}`}>{m.lyric || ' '}</div>
    </button>
  )
}

// Letra corrida: a letra normal, com os acordes em cima de onde entram.
function FlowLine({ measures, now, onSelect }: { measures: Measure[]; now?: PlayPos | null; onSelect: (i: number) => void }) {
  return (
    <p className="flex flex-wrap items-end gap-x-1 text-lg leading-tight" data-line>
      {measures.map((m) => (
        <span
          key={m.index}
          data-measure={m.index}
          onClick={() => onSelect(m.index)}
          className={`inline-flex cursor-pointer flex-col rounded px-0.5 ${now?.measure === m.index ? 'bg-accent-2/15' : ''}`}
        >
          <span className="flex gap-2 font-display text-base font-bold text-accent-2">
            {m.chords.map((c, k) => (
              <span key={k}>{songChordName(c.chord)}</span>
            ))}
            {!m.chords.length && ' '}
          </span>
          <span className="text-slate-100">{m.lyric || ' '}</span>
        </span>
      ))}
    </p>
  )
}

// --- Edição de um compasso (só com toques) --------------------------------------------

interface EditProps {
  measure: Measure
  beatsPerBar: number
  palette: SongChord[]
  onChange: (chords: MeasureChord[] | null) => void
  onClose: () => void
  onNext: () => void
}

function EditPanel({ measure, beatsPerBar, palette, onChange, onClose, onNext }: EditProps) {
  const [slot, setSlot] = useState(0)
  const [other, setOther] = useState(false)
  const chords = measure.chords.length ? measure.chords : [{ beat: 0, chord: null }]
  const k = Math.min(slot, chords.length - 1)
  const set = (next: MeasureChord[]) => onChange([...next].sort((a, b) => a.beat - b.beat))
  const pick = (c: SongChord | null) => {
    set(chords.map((x, i) => (i === k ? { ...x, chord: c } : x)))
    setOther(false)
  }
  const n = Math.max(measure.beats.length, beatsPerBar)
  const current = chords[k]?.chord

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 max-h-[70dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-panel/95 p-3 shadow-2xl backdrop-blur sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[26rem] sm:rounded-2xl sm:border">
      <div className="mb-2 flex items-center justify-between">
        <strong className="font-display">Compasso {measure.index + 1}</strong>
        <div className="flex gap-2">
          <button onClick={onNext} className="btn btn-round px-3 py-1 text-xs">
            Próximo ▶
          </button>
          <button onClick={onClose} className="btn btn-round px-3 py-1 text-xs" aria-label="Fechar">
            ✕
          </button>
        </div>
      </div>

      {/* Acordes do compasso: escolha qual corrigir */}
      <div className="mb-2 flex flex-wrap gap-2">
        {chords.map((c, i) => (
          <button
            key={i}
            onClick={() => setSlot(i)}
            aria-pressed={i === k}
            className={`btn px-3 py-1.5 font-display text-lg ${i === k ? 'btn-primary' : ''}`}
          >
            {songChordName(c.chord)}
            <span className="text-[10px] font-normal opacity-80">tempo {c.beat + 1}</span>
          </button>
        ))}
      </div>

      {/* Em que tempo este acorde entra (o 1º acorde é sempre no tempo 1) */}
      {k > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
          Entra no tempo:
          {Array.from({ length: n - 1 }, (_, b) => b + 1).map((b) => (
            <button
              key={b}
              disabled={chords.some((c, i) => i !== k && c.beat === b)}
              onClick={() => set(chords.map((x, i) => (i === k ? { ...x, beat: b } : x)))}
              aria-pressed={chords[k].beat === b}
              className={`btn btn-round h-8 w-8 p-0 text-xs ${chords[k].beat === b ? 'btn-primary' : ''}`}
            >
              {b + 1}
            </button>
          ))}
        </div>
      )}

      <div className="mb-2 flex flex-wrap gap-1.5">
        {palette.map((c) => (
          <button
            key={songChordName(c)}
            onClick={() => {
              pick(c)
              playChord(c)
            }}
            aria-pressed={songChordName(c) === songChordName(current)}
            className={`btn px-3 py-1.5 font-display ${songChordName(c) === songChordName(current) ? 'btn-primary' : ''}`}
          >
            {songChordName(c)}
          </button>
        ))}
        <button onClick={() => pick(null)} className="btn px-3 py-1.5 text-xs">
          sem acorde
        </button>
        <button onClick={() => setOther(!other)} aria-pressed={other} className="btn px-3 py-1.5 text-xs">
          outro…
        </button>
      </div>
      {other && (
        <div className="mb-2">
          <ChordPicker
            chord={toChordRef(current ?? { root: 'C', q: QUALITIES[0].id })}
            onChange={(c) => pick({ root: c.root, q: c.quality.id })}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-2">
        <button
          disabled={chords.length >= n}
          onClick={() => {
            // Divide: um novo acorde entra no meio do compasso (ou no próximo tempo livre).
            const free = [Math.floor(n / 2), ...Array.from({ length: n }, (_, b) => b)].find((b) => b > 0 && !chords.some((c) => c.beat === b))
            if (free === undefined) return
            set([...chords, { beat: free, chord: chords[chords.length - 1].chord }])
            setSlot(chords.length)
          }}
          className="btn px-3 py-1.5 text-xs"
        >
          ➗ Dividir compasso
        </button>
        <button
          disabled={chords.length < 2}
          onClick={() => {
            set(chords.filter((_, i) => i !== k || k === 0).slice(0, k === 0 ? 1 : undefined))
            setSlot(0)
          }}
          className="btn px-3 py-1.5 text-xs"
        >
          {k === 0 ? 'Um acorde só' : 'Tirar este acorde'}
        </button>
        {measure.edited && (
          <button onClick={() => onChange(null)} className="btn px-3 py-1.5 text-xs">
            ↺ Voltar ao automático
          </button>
        )}
      </div>
    </div>
  )
}
