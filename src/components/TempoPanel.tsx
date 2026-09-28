import { useRef, useState } from 'react'
import type { ChordTrack } from '../lib/chordMidi'
import { tapTempo } from '../lib/metronome'
import { BPM_RANGE, METERS, chordChanges, fitLyricSync, trackFromTaps, type Meter, type Sheet, type Song } from '../lib/song'
import { songChordName } from '../lib/songChords'
import type { SongPlayer } from '../lib/songPlayer'

// ---------------------------------------------------------------------------
// Tempo e sincronia da música: BPM (com "bater o tempo"), compasso,
// contagem de entrada, ajuste fino da letra e o modo "marcar tempo".
// ---------------------------------------------------------------------------

interface Props {
  song: Song
  sheet: Sheet
  player: SongPlayer | null
  hasVideo: boolean
  onChange: (patch: Partial<Song>) => void
}

const OFFSET_MAX = 10
const clampBpm = (v: number) => Math.min(BPM_RANGE.max, Math.max(BPM_RANGE.min, Math.round(v * 10) / 10))
const fmtOffset = (s: number) => `${s > 0 ? '+' : s < 0 ? '−' : ''}${Math.abs(s).toFixed(1).replace('.', ',')} s`

export function TempoPanel({ song, sheet, player, hasVideo, onChange }: Props) {
  const taps = useRef<number[]>([])
  const offset = song.lyricOffset
  // O cursor vai até ±10 s; se "Acertar pela voz" deslocou mais que isso, ele cresce junto.
  const range = Math.max(OFFSET_MAX, Math.ceil(Math.abs(offset)) + 1)
  const setOffset = (v: number) => onChange({ lyricOffset: Math.round(Math.max(-range, Math.min(range, v)) * 10) / 10 })
  const bpm = Math.round(sheet.bpm * 10) / 10
  const meter: Meter = song.meter ?? (`${sheet.beatsPerBar}/${song.track?.beatUnit ?? 4}` as Meter)

  return (
    <section className="rounded-2xl border border-line bg-panel/80 p-3 backdrop-blur sm:p-6">
      <h3 className="mb-3 font-display text-lg font-bold">Tempo e sincronia</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {/* BPM */}
        <div>
          <div className="mb-1 text-xs text-slate-400">
            BPM {song.bpmOverride ? '(editado)' : song.track ? '(do MIDI)' : '(padrão)'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => onChange({ bpmOverride: clampBpm(bpm - 1) })} className="btn btn-round h-10 w-10 p-0 text-xl" aria-label="Diminuir 1 BPM">
              −
            </button>
            <input
              type="number"
              inputMode="decimal"
              min={BPM_RANGE.min}
              max={BPM_RANGE.max}
              value={bpm}
              onChange={(e) => e.target.value && onChange({ bpmOverride: clampBpm(Number(e.target.value)) })}
              aria-label="BPM"
              className="w-20 rounded-lg border border-line bg-ink/60 px-2 py-1.5 text-center font-display text-xl font-bold tabular-nums outline-none focus:border-accent-2"
            />
            <button onClick={() => onChange({ bpmOverride: clampBpm(bpm + 1) })} className="btn btn-round h-10 w-10 p-0 text-xl" aria-label="Aumentar 1 BPM">
              +
            </button>
            <button
              onClick={() => {
                const r = tapTempo(taps.current)
                taps.current = r.taps
                if (r.bpm) onChange({ bpmOverride: clampBpm(r.bpm) })
              }}
              className="btn btn-round px-4"
            >
              Tap tempo
            </button>
            {song.bpmOverride !== undefined && song.track && (
              <button onClick={() => onChange({ bpmOverride: undefined })} className="text-xs text-slate-400 underline">
                voltar ao do MIDI
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Vale para o acompanhamento e o metrônomo. O vídeo e o MIDI seguem o tempo da gravação.</p>
        </div>

        {/* Compasso e contagem */}
        <div className="flex flex-col gap-3">
          <Choice
            label="Compasso"
            options={METERS.map((m) => ({ v: m, label: m }))}
            value={meter}
            onPick={(m) => onChange({ meter: m, measureEdits: {} })}
          />
          <Choice
            label="Contagem de entrada"
            options={[0, 1, 2, 3, 4].map((n) => ({ v: n, label: n ? String(n) : 'sem' }))}
            value={song.countIn ?? 0}
            onPick={(n) => onChange({ countIn: n })}
          />
        </div>

        {/* Ajuste fino da letra */}
        <div className="sm:col-span-2">
          <div className="mb-1 flex items-baseline justify-between text-xs text-slate-400">
            <span>Ajuste fino da letra (em relação aos acordes)</span>
            <strong className="font-display text-base text-white tabular-nums">{fmtOffset(offset)}</strong>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setOffset(offset - 0.1)} className="btn btn-round shrink-0 px-3" aria-label="Adiantar a letra 0,1 segundo">
              ◀ −0,1
            </button>
            <input
              type="range"
              min={-range}
              max={range}
              step={0.1}
              value={offset}
              onChange={(e) => setOffset(Number(e.target.value))}
              aria-label="Ajuste fino da letra, em segundos"
              aria-valuetext={fmtOffset(offset)}
              className="min-w-0 flex-1 accent-[var(--color-accent-2)]"
            />
            <button onClick={() => setOffset(offset + 0.1)} className="btn btn-round shrink-0 px-3" aria-label="Atrasar a letra 0,1 segundo">
              +0,1 ▶
            </button>
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-slate-500">
            <span>− adianta a letra</span>
            {offset !== 0 && (
              <button onClick={() => setOffset(0)} className="underline">
                zerar
              </button>
            )}
            <span>+ atrasa a letra</span>
          </div>
        </div>
      </div>

      <VoiceSync song={song} player={player} hasVideo={hasVideo} onChange={onChange} />
      <TapChanges song={song} sheet={sheet} player={player} hasVideo={hasVideo} onApply={(track) => onChange(track)} />
    </section>
  )
}

function Choice<T extends string | number>({ label, options, value, onPick }: { label: string; options: { v: T; label: string }[]; value: T; onPick: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400" role="group" aria-label={label}>
      <span className="w-full sm:w-36">{label}</span>
      {options.map((o) => (
        <button key={String(o.v)} onClick={() => onPick(o.v)} aria-pressed={value === o.v} className={`btn btn-round min-w-10 px-3 py-1 text-xs ${value === o.v ? 'btn-primary' : ''}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// --- "Acertar a letra pela voz" ------------------------------------------------------------
// Com o vídeo tocando, você toca no botão quando a voz começa a linha mostrada.
// Cada toque liga o tempo da linha na letra ao tempo real da gravação; a letra
// inteira é deslocada (e, com toques espalhados, a velocidade é corrigida).

interface VoiceProps {
  song: Song
  player: SongPlayer | null
  hasVideo: boolean
  onChange: (patch: Partial<Song>) => void
}

const MAX_HINT = 42

function VoiceSync({ song, player, hasVideo, onChange }: VoiceProps) {
  const lines = song.synced ? song.lyrics.filter((l) => l.text && l.t !== null) : []
  const [target, setTarget] = useState<number | null>(null) // índice da linha esperada
  const [pairs, setPairs] = useState<{ lrc: number; heard: number; i: number }[]>([])
  const active = target !== null
  const line = active ? lines[target] : null
  const hint = line ? (line.text.length > MAX_HINT ? line.text.slice(0, MAX_HINT).replace(/\s+\S*$/, '') + '…' : line.text) : ''
  const scale = song.lyricScale ?? 1

  const apply = (next: typeof pairs) => {
    setPairs(next)
    const fit = fitLyricSync(next)
    onChange({ lyricOffset: fit.offset, lyricScale: fit.scale === 1 ? undefined : fit.scale })
  }
  const start = () => {
    setPairs([])
    setTarget(0)
    player?.stop()
    void player?.play()
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-black/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">Acertar a letra pela voz</strong>
        {(song.lyricOffset !== 0 || scale !== 1) && !active && (
          <button onClick={() => onChange({ lyricOffset: 0, lyricScale: undefined })} className="btn btn-round px-3 py-1 text-xs">
            ↺ Voltar ao original
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Para quando a letra está adiantada ou atrasada (versões diferentes da música). O vídeo começa do início; toque no botão no instante em que
        o cantor começa a linha mostrada. Um toque já acerta; toques em linhas espalhadas pela música acertam também a velocidade.
      </p>
      {!active && (
        <button onClick={start} disabled={!hasVideo || !lines.length} className="btn btn-round mt-2 px-4">
          🎤 Começar a acertar
        </button>
      )}
      {!hasVideo && <p className="mt-1 text-xs text-amber-200">Precisa do vídeo: salve o link do YouTube e escolha a fonte "Gravação (YouTube)".</p>}
      {hasVideo && !lines.length && <p className="mt-1 text-xs text-amber-200">Esta letra não tem o tempo de cada linha.</p>}

      {active && (
        <div className="mt-3 flex flex-col items-center gap-3">
          {line ? (
            <button
              onPointerDown={(e) => {
                e.preventDefault()
                if (!player || !line) return
                apply([...pairs, { lrc: line.t!, heard: player.songTime(), i: target }])
                setTarget(target + 1 < lines.length ? target + 1 : null)
              }}
              className="btn btn-primary flex min-h-28 w-full max-w-sm flex-col gap-1 px-4 py-3 text-center"
            >
              <span className="text-xs font-normal opacity-90">Toque quando ouvir o começo de:</span>
              <span className="font-display text-lg leading-snug">“{hint}”</span>
              <span className="text-[11px] font-normal opacity-80">
                linha {target + 1} de {lines.length}
              </span>
            </button>
          ) : (
            <p className="text-sm text-emerald-300">Chegou ao fim da letra.</p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {line && (
              <button onClick={() => setTarget(target + 1 < lines.length ? target + 1 : null)} className="btn btn-round px-3 py-1 text-xs">
                Pular esta linha
              </button>
            )}
            <button
              onClick={() => {
                const last = pairs[pairs.length - 1]
                if (!last) return
                apply(pairs.slice(0, -1))
                setTarget(last.i)
              }}
              disabled={!pairs.length}
              className="btn btn-round px-3 py-1 text-xs"
            >
              ↶ Desfazer toque
            </button>
            <button onClick={() => setTarget(null)} className="btn btn-round px-3 py-1 text-xs">
              ✔ Concluir
            </button>
          </div>
          {pairs.length > 0 && (
            <p className="text-xs text-slate-300">
              {pairs.length} toque{pairs.length > 1 ? 's' : ''}: letra {fmtOffset(song.lyricOffset)}
              {scale !== 1 ? ` · velocidade ${(scale * 100).toFixed(1).replace('.', ',')}%` : ''}
            </p>
          )}
        </div>
      )}
      {!active && scale !== 1 && (
        <p className="mt-1 text-xs text-slate-400">Velocidade da letra corrigida para {(scale * 100).toFixed(1).replace('.', ',')}%.</p>
      )}
    </div>
  )
}

// --- Modo "marcar tempo" ----------------------------------------------------------------

interface TapProps {
  song: Song
  sheet: Sheet
  player: SongPlayer | null
  hasVideo: boolean
  onApply: (patch: Partial<Song>) => void
}

function TapChanges({ song, sheet, player, hasVideo, onApply }: TapProps) {
  const [changes, setChanges] = useState<ReturnType<typeof chordChanges> | null>(null)
  const [taps, setTaps] = useState<number[]>([])
  const marking = changes !== null

  const start = () => {
    setChanges(chordChanges(sheet))
    setTaps([])
    player?.stop()
    void player?.play()
  }
  const finish = () => {
    if (changes && taps.length >= 2) {
      const track: ChordTrack = trackFromTaps(song, sheet, taps, changes)
      onApply({ track, autoTrack: song.autoTrack ?? song.track, source: 'tap', measureEdits: {}, downbeatShift: 0 })
    }
    player?.pause()
    setChanges(null)
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-black/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">Marcar tempo</strong>
        {song.autoTrack && !marking && (
          <button
            onClick={() => onApply({ track: song.autoTrack, autoTrack: undefined, source: 'midi', measureEdits: {}, downbeatShift: 0 })}
            className="btn btn-round px-3 py-1 text-xs"
          >
            ↺ Voltar à marcação automática
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Enquanto o vídeo toca, aperte o botão grande a cada troca de acorde. Os momentos que você marcar substituem a marcação automática
        (a ordem dos acordes continua a mesma).
      </p>
      {!marking ? (
        <button
          onClick={start}
          disabled={!hasVideo || !sheet.chordsInOrder.length}
          className="btn btn-round mt-2 px-4"
        >
          ● Começar a marcar
        </button>
      ) : null}
      {!hasVideo && <p className="mt-1 text-xs text-amber-200">Salve o link do YouTube da música e escolha a fonte "Gravação (YouTube)".</p>}
      {hasVideo && !sheet.chordsInOrder.length && <p className="mt-1 text-xs text-amber-200">Primeiro importe o MIDI (ou cole a cifra) para o app saber quais acordes marcar.</p>}

      {marking && changes && (
        <div className="mt-3 flex flex-col items-center gap-3">
          <button
            onPointerDown={(e) => {
              e.preventDefault()
              if (!player || taps.length >= changes.length) return
              setTaps((t) => [...t, player.songTime()])
            }}
            disabled={taps.length >= changes.length}
            className="btn btn-primary btn-round h-32 w-32 flex-col text-center font-display text-3xl sm:h-40 sm:w-40"
          >
            {songChordName(changes[taps.length]) === '—' ? 'Fim' : songChordName(changes[taps.length])}
            <span className="text-xs font-normal">
              troca {Math.min(taps.length + 1, changes.length)} de {changes.length}
            </span>
          </button>
          <div className="flex gap-2">
            <button onClick={() => setTaps((t) => t.slice(0, -1))} disabled={!taps.length} className="btn btn-round px-3 py-1 text-xs">
              ↶ Desfazer toque
            </button>
            <button onClick={finish} className="btn btn-round px-3 py-1 text-xs">
              {taps.length >= 2 ? '✔ Concluir e salvar' : 'Cancelar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
