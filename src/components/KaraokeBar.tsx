import type { PlayState, SoundSource } from '../lib/songPlayer'
import { SOURCES, STRUM_PATTERNS, type PatternId } from '../lib/songPlayer'
import { songChordName, type SongChord } from '../lib/songChords'

// ---------------------------------------------------------------------------
// Barra de controle do karaokê, fixa embaixo da tela: acorde atual e o
// próximo em destaque, tocar/pausar/parar, voltar ao início da seção,
// velocidade, metrônomo e a fonte do som. Botões grandes para o celular.
// ---------------------------------------------------------------------------

interface Props {
  state: PlayState
  current: SongChord | null
  next: SongChord | null
  label: string // seção atual
  source: SoundSource
  available: Record<SoundSource, boolean>
  rate: number
  metronome: boolean
  pattern: PatternId
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onSection: () => void
  onRate: (r: number) => void
  onMetronome: (on: boolean) => void
  onSource: (s: SoundSource) => void
  onPattern: (p: PatternId) => void
  children?: React.ReactNode // botões extras na linha do transporte (gravação)
  above?: React.ReactNode // quadros logo acima da barra (recados, gravação)
}

export function KaraokeBar(p: Props) {
  const playing = p.state === 'playing' || p.state === 'counting'
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.35)] backdrop-blur">
      {p.above && <div className="absolute inset-x-2 bottom-full mx-auto mb-2 flex max-w-3xl flex-col gap-2">{p.above}</div>}
      <div className="mx-auto flex max-w-6xl flex-col gap-2">
        <div className="flex items-center gap-2">
          {/* Agora / a seguir */}
          <div className="flex min-w-0 flex-1 items-end gap-3">
            <div className="min-w-0">
              <div className="text-[10px] tracking-wide text-slate-400 uppercase">{p.state === 'counting' ? 'contando…' : p.label || 'agora'}</div>
              <div className="font-display text-4xl leading-none font-bold text-accent-2">{songChordName(p.current)}</div>
            </div>
            <div className="min-w-0 opacity-80">
              <div className="text-[10px] tracking-wide text-slate-400 uppercase">a seguir</div>
              <div className="font-display text-2xl leading-none font-bold">{p.next ? songChordName(p.next) : '—'}</div>
            </div>
          </div>
          {/* Transporte */}
          <button onClick={p.onSection} className="btn btn-round h-12 w-12 p-0 text-lg" aria-label="Voltar ao início da seção" title="Início da seção">
            ⏮
          </button>
          <button
            onClick={playing ? p.onPause : p.onPlay}
            className="btn btn-primary btn-round h-14 w-14 p-0 text-2xl"
            aria-label={playing ? 'Pausar' : 'Tocar'}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button onClick={p.onStop} className="btn btn-round h-12 w-12 p-0 text-lg" aria-label="Parar">
            ■
          </button>
          {p.children}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-300">
          <label className="flex items-center gap-1.5">
            <span className="sr-only sm:not-sr-only">Som</span>
            <select
              value={p.source}
              onChange={(e) => p.onSource(e.target.value as SoundSource)}
              aria-label="Fonte do som"
              className="max-w-[10.5rem] rounded-lg border border-line bg-panel px-2 py-1.5 text-white"
            >
              {SOURCES.map((s) => (
                <option key={s.id} value={s.id} disabled={!p.available[s.id]}>
                  {s.label}
                  {!p.available[s.id] ? ' (indisponível)' : ''}
                </option>
              ))}
            </select>
          </label>
          {p.source === 'acomp' && (
            <select
              value={p.pattern}
              onChange={(e) => p.onPattern(e.target.value as PatternId)}
              aria-label="Batida do acompanhamento"
              className="rounded-lg border border-line bg-panel px-2 py-1.5 text-white"
            >
              {STRUM_PATTERNS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          <label className="flex min-w-[9rem] flex-1 items-center gap-1.5 sm:max-w-[16rem]">
            <span className="shrink-0">Velocidade</span>
            <input
              type="range"
              min={0.5}
              max={1.2}
              step={0.05}
              value={p.rate}
              onChange={(e) => p.onRate(Number(e.target.value))}
              aria-label="Velocidade"
              className="min-w-0 flex-1 accent-[var(--color-accent)]"
            />
            <button onClick={() => p.onRate(1)} className="w-10 shrink-0 text-right tabular-nums" title="Voltar a 100%">
              {Math.round(p.rate * 100)}%
            </button>
          </label>
          <button
            onClick={() => p.onMetronome(!p.metronome)}
            aria-pressed={p.metronome}
            className={`btn btn-round px-3 py-1 text-xs ${p.metronome ? 'btn-primary' : ''}`}
          >
            Metrônomo {p.metronome ? 'ligado' : 'desligado'}
          </button>
        </div>
      </div>
    </div>
  )
}
