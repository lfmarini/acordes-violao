import { useEffect, useRef, useState } from 'react'
import { DEFAULT_EXERCISE, exerciseGroups, findExercise, sequenceLabel, stepLabel } from '../lib/exercises'
import { NOTES_PER_BEAT, RHYTHM_BPM_DEFAULT, RHYTHM_BPM_MAX, RHYTHM_BPM_MIN, RhythmClock, type Tick } from '../lib/rhythmClock'
import { useStoredState } from '../lib/storage'

// ---------------------------------------------------------------------------
// Treino de ritmo (aba Aprendizado): escolha um exercício de dedos, o BPM e
// quantas notas por tempo. O metrônomo conta 1 compasso e depois acende, a
// cada nota da grade, o dedo da vez. O app não precisa saber qual dedo você
// tocou; nas próximas etapas ele vai medir só o tempo dos seus ataques.
// ---------------------------------------------------------------------------

const clampBpm = (v: number) => Math.min(RHYTHM_BPM_MAX, Math.max(RHYTHM_BPM_MIN, Math.round(v)))
const NPS_LABEL: Record<number, string> = { 1: '1', 2: '2', 3: '3 (tercina)', 4: '4' }

export function RhythmTrainer({ active }: { active: boolean }) {
  const [exerciseId, setExerciseId] = useStoredState('ritmo-exercicio', DEFAULT_EXERCISE)
  const [bpm, setBpm] = useStoredState('ritmo-bpm', RHYTHM_BPM_DEFAULT)
  const [nps, setNps] = useStoredState('ritmo-notas-por-tempo', 1)
  const [beats, setBeats] = useStoredState('ritmo-compasso', 4)
  const [volume, setVolume] = useStoredState('ritmo-volume', 0.8)
  const [subClicks, setSubClicks] = useStoredState('ritmo-clique-subdivisoes', false)
  const [running, setRunning] = useState(false)
  const [tick, setTick] = useState<Tick | null>(null)
  // Texto sendo digitado no campo de BPM (null = mostra o BPM atual).
  const [bpmDraft, setBpmDraft] = useState<string | null>(null)
  const clock = useRef<RhythmClock | null>(null)
  const exercise = findExercise(exerciseId)

  // Cria o metrônomo uma vez; desliga ao sair da página.
  useEffect(() => {
    const c = new RhythmClock()
    c.onTick = (t) => setTick(t)
    clock.current = c
    return () => c.release()
  }, [])

  // Mudanças valem na hora, mesmo tocando (as notas por tempo, no próximo tempo).
  useEffect(() => {
    const c = clock.current
    if (!c) return
    c.bpm = bpm
    c.beatsPerBar = beats
    c.notesPerBeat = nps
    c.subClicks = subClicks
    c.setVolume(volume)
  }, [bpm, beats, nps, subClicks, volume])

  const stop = () => {
    clock.current?.stop()
    setRunning(false)
    setTick(null)
  }

  const toggle = () => {
    const c = clock.current!
    if (c.running) return stop()
    c.start()
    setRunning(true)
  }

  // Sair da aba (ou trocar para o modo Livre) para o metrônomo.
  useEffect(() => {
    if (!active && clock.current?.running) stop()
  }, [active])

  // Barra de espaço liga/desliga, só com este modo aberto e fora de campos e botões.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.code !== 'Space' || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const countIn = running && (!tick || tick.bar < 0)
  const current = tick && tick.note >= 0 ? tick.note % exercise.steps.length : -1
  const lap = tick && tick.note >= 0 ? Math.floor(tick.note / exercise.steps.length) + 1 : 0
  const shownNps = tick?.nps ?? nps

  const commitBpmText = () => {
    const v = Number((bpmDraft ?? '').replace(',', '.'))
    if (bpmDraft !== null && Number.isFinite(v) && v > 0) setBpm(clampBpm(v))
    setBpmDraft(null)
  }

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-panel/80 p-3 backdrop-blur sm:p-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-bold">Treino de ritmo</h2>
        <span className="text-sm text-slate-400">
          {bpm} BPM · {nps} {nps === 1 ? 'nota' : 'notas'} por tempo
        </span>
      </div>

      {/* Exercício */}
      <label className="block text-sm text-slate-300">
        Exercício
        <select
          value={exercise.id}
          onChange={(e) => setExerciseId(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-base text-white"
        >
          {exerciseGroups().map(([group, list]) => (
            <optgroup key={group} label={group}>
              {list.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {/* Sequência de dedos: o da vez acende */}
      <div className="mt-4 rounded-xl border border-line bg-black/25 p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
          <span>Dedos da mão esquerda, nesta ordem</span>
          <span className="tabular-nums">{lap > 0 ? `volta ${lap}` : sequenceLabel(exercise.steps)}</span>
        </div>
        <div
          className="mx-auto grid max-w-md gap-2"
          style={{ gridTemplateColumns: `repeat(${Math.min(4, exercise.steps.length)}, minmax(0, 1fr))` }}
        >
          {exercise.steps.map((s, i) => {
            const on = i === current
            return (
              <div
                key={i}
                className={`flex h-16 flex-col items-center justify-center rounded-xl border px-1 transition-[transform,background-color] duration-75 sm:h-20 ${
                  on ? 'scale-110 border-accent bg-accent text-white' : 'border-line bg-panel text-slate-300'
                }`}
              >
                <span className="font-display text-3xl font-bold tabular-nums sm:text-4xl">{stepLabel(s)}</span>
                {s.string && <span className={`text-[10px] ${on ? 'text-white/80' : 'text-slate-500'}`}>corda {s.string}</span>}
              </div>
            )
          })}
        </div>
        {exercise.hint && <p className="mt-2 text-center text-xs text-slate-400">{exercise.hint}</p>}

        {/* Tempos do compasso, com as divisões de cada tempo */}
        <div className="mt-4 flex flex-wrap justify-center gap-3" aria-hidden>
          {Array.from({ length: beats }, (_, b) => (
            <div key={b} className="flex items-center gap-1">
              {Array.from({ length: countIn ? 1 : shownNps }, (_, s) => {
                const on = tick !== null && tick.beat === b && tick.sub === s
                const main = s === 0
                return (
                  <span
                    key={s}
                    className={`rounded-full transition-opacity duration-75 ${main ? 'h-4 w-4' : 'h-2.5 w-2.5'} ${
                      countIn ? 'bg-amber-300' : b === 0 && main ? 'bg-accent' : 'bg-accent-2'
                    } ${on ? 'opacity-100' : 'opacity-20'}`}
                  />
                )
              })}
            </div>
          ))}
        </div>
        <p className="mt-2 h-5 text-center text-sm font-semibold text-amber-300" aria-live="polite">
          {countIn ? `Contagem: ${tick ? tick.beat + 1 : '…'} de ${beats}` : ''}
        </p>
      </div>

      {/* BPM */}
      <div className="mt-4 flex items-center justify-center gap-3">
        <button onClick={() => setBpm(clampBpm(bpm - 5))} aria-label="Diminuir 5 BPM" className="btn btn-round h-11 w-11 p-0 text-sm">
          −5
        </button>
        <button onClick={() => setBpm(clampBpm(bpm - 1))} aria-label="Diminuir 1 BPM" className="btn btn-round h-11 w-11 p-0 text-xl">
          −
        </button>
        <label className="w-24 text-center">
          <input
            type="number"
            inputMode="numeric"
            min={RHYTHM_BPM_MIN}
            max={RHYTHM_BPM_MAX}
            value={bpmDraft ?? bpm}
            onChange={(e) => setBpmDraft(e.target.value)}
            onBlur={commitBpmText}
            onKeyDown={(e) => e.key === 'Enter' && commitBpmText()}
            aria-label="Andamento em batidas por minuto"
            className="w-full rounded-lg border border-line bg-transparent text-center font-display text-4xl font-bold text-white tabular-nums"
          />
          <span className="text-xs tracking-widest text-slate-400">BPM</span>
        </label>
        <button onClick={() => setBpm(clampBpm(bpm + 1))} aria-label="Aumentar 1 BPM" className="btn btn-round h-11 w-11 p-0 text-xl">
          +
        </button>
        <button onClick={() => setBpm(clampBpm(bpm + 5))} aria-label="Aumentar 5 BPM" className="btn btn-round h-11 w-11 p-0 text-sm">
          +5
        </button>
      </div>
      <input
        type="range"
        min={RHYTHM_BPM_MIN}
        max={RHYTHM_BPM_MAX}
        value={bpm}
        onChange={(e) => setBpm(clampBpm(Number(e.target.value)))}
        aria-label="Andamento"
        className="mt-3 w-full accent-[var(--color-accent)]"
      />
      <div className="flex justify-between text-xs text-slate-500">
        <span>{RHYTHM_BPM_MIN}</span>
        <span>{RHYTHM_BPM_MAX}</span>
      </div>

      {/* Notas por tempo */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-slate-300" role="group" aria-label="Notas por tempo">
        <span className="w-full text-center sm:w-auto">Notas por tempo:</span>
        {NOTES_PER_BEAT.map((n) => (
          <button
            key={n}
            onClick={() => setNps(n)}
            aria-pressed={nps === n}
            className={`btn btn-round px-3 py-1.5 text-sm ${nps === n ? 'btn-primary' : ''}`}
          >
            {NPS_LABEL[n]}
          </button>
        ))}
      </div>

      <div className="mt-5 flex justify-center">
        <button onClick={toggle} className={`btn btn-round min-w-44 px-6 py-3 text-base ${running ? 'btn-danger' : 'btn-primary'}`}>
          {running ? '■ Parar' : '▶ Começar'}
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm">
        <label className="flex items-center gap-2 text-slate-300">
          Compasso
          <select
            value={beats}
            onChange={(e) => setBeats(Number(e.target.value))}
            className="rounded-lg border border-line bg-panel px-2 py-1 text-white"
          >
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} tempos
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-slate-300">
          Volume
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Volume do metrônomo"
            className="w-24 accent-[var(--color-accent-2)]"
          />
        </label>
        <label className="flex items-center gap-2 text-slate-300">
          <input type="checkbox" checked={subClicks} onChange={(e) => setSubClicks(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
          Clique nas divisões
        </label>
      </div>

      <p className="mt-4 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
        🎧 Use fone de ouvido: assim o microfone escuta só o violão, e não o clique do metrônomo.
      </p>
      <p className="mt-2 text-center text-xs text-slate-500">
        Antes de começar, o metrônomo conta 1 compasso. O 1º tempo soa mais agudo. Barra de espaço liga e desliga.
      </p>
    </section>
  )
}
