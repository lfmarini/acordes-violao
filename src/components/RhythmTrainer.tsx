import { useEffect, useMemo, useRef, useState } from 'react'
import { QUALITIES, ROOTS, chordDisplayName, shapesFor, type ChordRef } from '../lib/chords'
import { DEFAULT_EXERCISE, exerciseGroups, findExercise, sequenceLabel, stepLabel } from '../lib/exercises'
import { micErrorMessage, openMicrophone, type MicSession } from '../lib/microphone'
import type { AnalysisOptions, Take, TakeAnalysis } from '../lib/rhythmAnalysis'
import { LADDER, NOTES_PER_BEAT, RHYTHM_BPM_DEFAULT, RHYTHM_BPM_MAX, RHYTHM_BPM_MIN, RhythmClock, type Tick } from '../lib/rhythmClock'
import { deleteSession, loadSessions, saveSession, type RhythmSession } from '../lib/rhythmHistory'
import { delayStats } from '../lib/rhythmStats'
import { SENSITIVITY_DEFAULT } from '../lib/onsets'
import { useStoredState } from '../lib/storage'
import { ChordMini } from './ChordMini'
import { RhythmHistory } from './RhythmHistory'
import { LatencyField, RhythmResults, TOLERANCE_DEFAULT } from './RhythmResults'

// ---------------------------------------------------------------------------
// Treino de ritmo (aba Aprendizado).
//
// Escolha um exercício de dedos (ou dois acordes para trocar), o BPM e
// quantas notas por tempo. Ao começar, o app liga o microfone e grava, o
// metrônomo conta 1 compasso e depois acende, a cada nota da grade, o dedo
// da vez. Ao parar, o app acha os ataques do violão na gravação e mede o
// d3lay de cada um em relação ao ponto mais próximo da grade. O app não
// precisa saber qual dedo você tocou: mede só o tempo.
//
// O metrônomo e o microfone usam o MESMO relógio de áudio, então beats e
// ataques ficam na mesma linha do tempo. A latência (atraso do fone e do
// microfone) é descontada: a automática, que o navegador informa, mais um
// ajuste manual ou pela calibração.
// ---------------------------------------------------------------------------

const clampBpm = (v: number) => Math.min(RHYTHM_BPM_MAX, Math.max(RHYTHM_BPM_MIN, Math.round(v)))
const NPS_LABEL: Record<number, string> = { 1: '1', 2: '2', 3: '3 (tercina)', 4: '4' }
/** Limite de uma gravação (minutos): depois disso o treino para sozinho. */
const MAX_TAKE_MIN = 10
/** Batidas da calibração de latência. */
const CAL_BEATS = 8
const CAL_BPM = 80
const PROGRESSION_START = 40
const PROGRESSION_STEP = 5

type Mode = 'dedos' | 'acordes'
interface StoredChord {
  root: string
  quality: string
}
const toChord = (c: StoredChord): ChordRef => ({ root: c.root, quality: QUALITIES.find((q) => q.id === c.quality) ?? QUALITIES[0] })

/** O que valia quando a gravação foi feita (para o histórico e a análise). */
interface TakeMeta {
  id: string
  exerciseId: string
  exerciseName: string
  bpm: number
  nps: number
  offbeat: boolean
  calibration: boolean
  tags: string[]
}

interface LoadedTake extends Take {
  autoLatency: number
  meta: TakeMeta
}

export function RhythmTrainer({ active }: { active: boolean }) {
  // ---- Ajustes (lembrados neste aparelho) ----
  const [mode, setMode] = useStoredState<Mode>('ritmo-modo', 'dedos')
  const [exerciseId, setExerciseId] = useStoredState('ritmo-exercicio', DEFAULT_EXERCISE)
  const [bpm, setBpm] = useStoredState('ritmo-bpm', RHYTHM_BPM_DEFAULT)
  const [nps, setNps] = useStoredState('ritmo-notas-por-tempo', 1)
  const [beats, setBeats] = useStoredState('ritmo-compasso', 4)
  const [volume, setVolume] = useStoredState('ritmo-volume', 0.8)
  const [subClicks, setSubClicks] = useStoredState('ritmo-clique-subdivisoes', false)
  const [record, setRecord] = useStoredState('ritmo-gravar', true)
  const [tolerance, setTolerance] = useStoredState('ritmo-tolerancia', TOLERANCE_DEFAULT)
  const [sensitivity, setSensitivity] = useStoredState('ritmo-sensibilidade', SENSITIVITY_DEFAULT)
  const [latencyAdjust, setLatencyAdjust] = useStoredState('ritmo-ajuste-latencia', 0)
  const [ladderBars, setLadderBars] = useStoredState('ritmo-escada', 0)
  const [firstBeatOnly, setFirstBeatOnly] = useStoredState('ritmo-so-tempo-1', false)
  const [muteBars, setMuteBars] = useStoredState('ritmo-silenciar', 0)
  const [muteEvery, setMuteEvery] = useStoredState('ritmo-silenciar-a-cada', 4)
  const [offbeat, setOffbeat] = useStoredState('ritmo-contratempo', false)
  const [chordA, setChordA] = useStoredState<StoredChord>('ritmo-acorde-a', { root: 'C', quality: 'maior' })
  const [chordB, setChordB] = useStoredState<StoredChord>('ritmo-acorde-b', { root: 'G', quality: 'maior' })
  const [changeEvery, setChangeEvery] = useStoredState('ritmo-trocar-a-cada', 4)
  const [progression, setProgression] = useStoredState('ritmo-progressao', false)
  const [progressionLimit, setProgressionLimit] = useStoredState('ritmo-progressao-limite', 90)

  // ---- Estado da rodada ----
  const [running, setRunning] = useState(false)
  const [calibrating, setCalibrating] = useState(false)
  const [recording, setRecording] = useState(false)
  const [tick, setTick] = useState<Tick | null>(null)
  const [error, setError] = useState('')
  const [calMsg, setCalMsg] = useState('')
  const [bpmDraft, setBpmDraft] = useState<string | null>(null)
  const [take, setTake] = useState<LoadedTake | null>(null)
  const [analysis, setAnalysis] = useState<TakeAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [sessions, setSessions] = useState<RhythmSession[]>(() => loadSessions())
  const clock = useRef<RhythmClock | null>(null)
  const mic = useRef<MicSession | null>(null)
  const meta = useRef<TakeMeta | null>(null)
  const stopRef = useRef<() => void>(() => {})
  const resultsRef = useRef<HTMLDivElement>(null)

  const exercise = findExercise(exerciseId)
  const chords = useMemo(() => [toChord(chordA), toChord(chordB)], [chordA, chordB])
  const chordShapes = useMemo(() => chords.map((c) => shapesFor(c)[0] ?? null), [chords])
  const chordExerciseId = `acordes:${chordDisplayName(chords[0])}-${chordDisplayName(chords[1])}:${changeEvery}`
  const chordExerciseName = `Troca ${chordDisplayName(chords[0])} ↔ ${chordDisplayName(chords[1])} (a cada ${changeEvery} tempos)`
  const currentExerciseId = mode === 'acordes' ? chordExerciseId : exercise.id

  // Cria o metrônomo uma vez; desliga ao sair da página.
  useEffect(() => {
    const c = new RhythmClock()
    c.onTick = (t) => {
      setTick(t)
      // Calibração: para sozinha depois das batidas combinadas.
      if (meta.current?.calibration && t.note >= CAL_BEATS) stopRef.current()
    }
    clock.current = c
    return () => {
      const ctx = c.context
      c.release()
      if (mic.current) mic.current.close()
      else if (ctx && ctx.state !== 'closed') void ctx.close()
    }
  }, [])

  // Mudanças valem na hora, mesmo tocando (as notas por tempo, no próximo tempo).
  useEffect(() => {
    const c = clock.current
    if (!c || calibrating) return
    c.bpm = bpm
    c.beatsPerBar = beats
    c.notesPerBeat = nps
    c.subClicks = subClicks
    c.firstBeatOnly = firstBeatOnly
    c.ladderBars = ladderBars
    c.muteBars = muteBars
    c.muteEvery = muteEvery
    c.setVolume(volume)
  }, [bpm, beats, nps, subClicks, volume, firstBeatOnly, ladderBars, muteBars, muteEvery, calibrating])

  // ---- Análise num worker (não trava a tela) ----
  const worker = useRef<Worker | null>(null)
  const jobId = useRef(0)
  useEffect(() => () => worker.current?.terminate(), [])

  // Calibração: a mediana do d3lay vira o ajuste de latência.
  const finishCalibration = (result: TakeAnalysis, autoLatency: number) => {
    const delays = result.matching.hits.map((h) => h.delay)
    if (delays.length < 5) {
      setCalMsg(`Só achei ${delays.length} ataques de ${CAL_BEATS}. Tente de novo, tocando mais forte junto com os cliques.`)
    } else {
      const sorted = [...delays].sort((a, b) => a - b)
      const med = Math.round(sorted[Math.floor(sorted.length / 2)])
      setLatencyAdjust(med)
      setCalMsg(`Calibrado: ajuste de ${med > 0 ? '+' : ''}${med} ms (latência total ${Math.round(autoLatency * 1000 + med)} ms).`)
    }
    setTake(null)
    worker.current?.terminate()
    worker.current = null
  }

  const loadTake = (t: LoadedTake) => {
    worker.current?.terminate()
    const w = new Worker(new URL('../lib/rhythm.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: number; result?: TakeAnalysis; error?: string }>) => {
      if (e.data.id !== jobId.current) return // resposta velha
      setAnalyzing(false)
      if (!e.data.result) return setError('Não consegui analisar a gravação.')
      if (t.meta.calibration) return finishCalibration(e.data.result, t.autoLatency)
      setAnalysis(e.data.result)
    }
    const plain: Take = { samples: t.samples, sampleRate: t.sampleRate, startCtx: t.startCtx, ticks: t.ticks }
    w.postMessage({ type: 'load', take: plain })
    worker.current = w
    setSessions(loadSessions()) // inclui a sessão da gravação anterior
    setAnalysis(null)
    setTake(t)
  }

  // Pede a análise de novo quando a gravação, a sensibilidade ou a latência mudam.
  useEffect(() => {
    if (!take || !worker.current) return
    const cal = take.meta.calibration
    const options: AnalysisOptions = {
      latency: take.autoLatency + (cal ? 0 : latencyAdjust / 1000),
      sensitivity,
      offbeat: take.meta.offbeat,
      rejectClicks: true,
    }
    const id = ++jobId.current
    const t = setTimeout(() => {
      setAnalyzing(true)
      worker.current?.postMessage({ type: 'analyze', id, options })
    }, 200)
    return () => clearTimeout(t)
  }, [take, sensitivity, latencyAdjust])

  // Histórico: cada gravação analisada vira uma sessão (atualizada se x ou a sensibilidade mudarem).
  const stats = useMemo(() => (analysis ? delayStats(analysis.matching.hits.map((h) => h.delay), tolerance) : null), [analysis, tolerance])
  const [removedLive, setRemovedLive] = useState('')
  const liveSession = useMemo<RhythmSession | null>(() => {
    if (!take || take.meta.calibration || !stats || analyzing || stats.n < 4 || take.meta.id === removedLive) return null
    const m = take.meta
    return {
      id: m.id,
      date: m.id,
      exerciseId: m.exerciseId,
      exerciseName: m.exerciseName,
      bpm: m.bpm,
      nps: m.nps,
      tolerance,
      hitPct: stats.hitPct,
      meanAbs: stats.meanAbs,
      medianAbs: stats.medianAbs,
      meanSigned: stats.meanSigned,
      n: stats.n,
      tags: m.tags.length ? m.tags : undefined,
    }
  }, [take, stats, analyzing, tolerance, removedLive])
  useEffect(() => {
    if (liveSession) saveSession(liveSession)
  }, [liveSession])
  const allSessions = useMemo(
    () => (liveSession ? [...sessions.filter((x) => x.id !== liveSession.id), liveSession] : sessions),
    [sessions, liveSession],
  )
  const removeSession = (id: string) => {
    if (id === liveSession?.id) setRemovedLive(id)
    setSessions(deleteSession(id))
  }

  // ---- Começar / parar ----
  const stop = () => {
    const c = clock.current
    c?.stop()
    setRunning(false)
    setCalibrating(false)
    setRecording(false)
    setTick(null)
    const m = mic.current
    mic.current = null
    if (!c) return
    if (!m) {
      // Sem microfone, o relógio de áudio desta rodada não serve mais.
      void c.context?.close()
      return
    }
    const rec = m.recorder
    if (rec && rec.seconds > 1 && meta.current) {
      const autoLatency = (m.ctx.outputLatency || 0) + (m.ctx.baseLatency || 0) + m.inputLatency
      loadTake({
        samples: rec.floatSamples(),
        sampleRate: rec.sampleRate,
        startCtx: rec.startCtxTime,
        ticks: [...c.ticks],
        autoLatency,
        meta: meta.current,
      })
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    }
    m.close()
  }
  useEffect(() => {
    stopRef.current = stop
  })

  const start = async (calibration = false) => {
    const c = clock.current!
    if (c.running) return
    setError('')
    setCalMsg('')
    const tags = [
      ladderBars ? `escada a cada ${ladderBars}` : '',
      offbeat ? 'contratempo' : '',
      firstBeatOnly ? 'clique só no 1' : '',
      muteBars ? `silêncio ${muteBars}/${muteEvery}` : '',
    ].filter(Boolean)
    meta.current = {
      id: new Date().toISOString(),
      exerciseId: currentExerciseId,
      exerciseName: mode === 'acordes' ? chordExerciseName : exercise.name,
      bpm: calibration ? CAL_BPM : bpm,
      nps: calibration ? 1 : ladderBars ? 0 : nps,
      offbeat: !calibration && offbeat,
      calibration,
      tags: calibration ? [] : tags,
    }
    if (calibration) {
      c.bpm = CAL_BPM
      c.notesPerBeat = 1
      c.ladderBars = 0
      c.muteBars = 0
      c.firstBeatOnly = false
      c.subClicks = false
      setCalibrating(true)
    }
    // O relógio de áudio nasce aqui, dentro do toque (alguns celulares exigem).
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    void ctx.resume()
    if (record || calibration) {
      try {
        const m = await openMicrophone(0, { denoise: false, ctx })
        mic.current = m
        setRecording(true)
      } catch (e) {
        setError(`${micErrorMessage(e)} O metrônomo toca, mas sem gravar.`)
        if (calibration) {
          setCalibrating(false)
          void ctx.close()
          return
        }
      }
    }
    c.start(ctx)
    setRunning(true)
  }

  const toggle = () => (clock.current?.running ? stop() : void start())

  // Limite de duração de uma gravação.
  useEffect(() => {
    if (!running) return
    const t = setTimeout(() => stopRef.current(), MAX_TAKE_MIN * 60 * 1000)
    return () => clearTimeout(t)
  }, [running])

  // Sair da aba (ou trocar para o modo Livre) para tudo.
  useEffect(() => {
    if (!active && clock.current?.running) stopRef.current()
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

  // ---- O que mostrar agora ----
  const countIn = running && (!tick || tick.bar < 0)
  const current = tick && tick.note >= 0 ? tick.note % exercise.steps.length : -1
  const lap = tick && tick.note >= 0 ? Math.floor(tick.note / exercise.steps.length) + 1 : 0
  const shownNps = tick?.nps ?? (ladderBars ? LADDER[0] : nps)
  const beatNo = tick && tick.bar >= 0 ? tick.bar * beats + tick.beat : -1
  const chordNow = beatNo >= 0 ? Math.floor(beatNo / changeEvery) % 2 : -1
  const beatsToChange = beatNo >= 0 ? changeEvery - (beatNo % changeEvery) : changeEvery
  const silentNow = !!tick?.muted
  const suggestUp =
    progression && take && !take.meta.calibration && stats && stats.n >= 4 && !analyzing && stats.hitPct >= progressionLimit && take.meta.bpm === bpm

  const commitBpmText = () => {
    const v = Number((bpmDraft ?? '').replace(',', '.'))
    if (bpmDraft !== null && Number.isFinite(v) && v > 0) setBpm(clampBpm(v))
    setBpmDraft(null)
  }

  return (
    <>
      <section className="min-w-0 rounded-2xl border border-line bg-panel/80 p-3 backdrop-blur sm:p-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-bold">Treino de ritmo</h2>
          <span className="text-sm text-slate-400">
            {bpm} BPM · {ladderBars ? 'escada' : `${nps} ${nps === 1 ? 'nota' : 'notas'} por tempo`}
          </span>
        </div>

        {/* Dedos ou troca de acordes */}
        <div className="mb-3 flex gap-2" role="group" aria-label="Tipo de exercício">
          {[
            { id: 'dedos' as const, label: 'Dedos' },
            { id: 'acordes' as const, label: 'Troca de acordes' },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              disabled={running}
              aria-pressed={mode === m.id}
              className={`btn btn-round flex-1 px-3 py-1.5 ${mode === m.id ? 'btn-primary' : ''}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'dedos' ? (
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
        ) : (
          <div className="grid grid-cols-2 gap-2 text-sm text-slate-300">
            {[
              { v: chordA, set: setChordA, label: '1º acorde' },
              { v: chordB, set: setChordB, label: '2º acorde' },
            ].map((c) => (
              <div key={c.label}>
                {c.label}
                <div className="mt-1 flex gap-1">
                  <select
                    value={c.v.root}
                    onChange={(e) => c.set({ ...c.v, root: e.target.value })}
                    aria-label={`Tônica do ${c.label}`}
                    className="w-16 rounded-lg border border-line bg-panel px-1 py-2 text-white"
                  >
                    {ROOTS.map((r) => (
                      <option key={r.name} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={c.v.quality}
                    onChange={(e) => c.set({ ...c.v, quality: e.target.value })}
                    aria-label={`Tipo do ${c.label}`}
                    className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-1 py-2 text-white"
                  >
                    {QUALITIES.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.br || 'maior'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            <label className="col-span-2 flex items-center gap-2">
              Trocar a cada
              <select
                value={changeEvery}
                onChange={(e) => setChangeEvery(Number(e.target.value))}
                className="rounded-lg border border-line bg-panel px-2 py-1 text-white"
              >
                {[1, 2, 4, 8].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? 'tempo' : 'tempos'}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {/* O que tocar agora */}
        <div className={`mt-4 rounded-xl border bg-black/25 p-3 ${silentNow ? 'border-amber-300/50' : 'border-line'}`}>
          {mode === 'dedos' ? (
            <>
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
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {chords.map((c, i) => {
                const on = chordNow === i || (chordNow < 0 && i === 0)
                return (
                  <div
                    key={i}
                    className={`flex flex-col items-center rounded-xl border p-2 transition-colors duration-75 ${
                      on ? 'border-accent bg-accent/25 text-white' : 'border-line bg-panel text-slate-400'
                    }`}
                  >
                    <span className="font-display text-3xl font-bold">{chordDisplayName(c)}</span>
                    <ChordMini shape={chordShapes[i]} className="mt-1 h-20 w-20" />
                    {on && chordNow >= 0 && (
                      <span className="text-[11px] tabular-nums">
                        troca em {beatsToChange} {beatsToChange === 1 ? 'tempo' : 'tempos'}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

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
                        countIn ? 'bg-amber-300' : silentNow ? 'bg-slate-400' : b === 0 && main ? 'bg-accent' : 'bg-accent-2'
                      } ${on ? 'opacity-100' : 'opacity-20'}`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
          <p className="mt-2 h-5 text-center text-sm font-semibold text-amber-300" aria-live="polite">
            {calibrating
              ? countIn
                ? `Contagem: ${tick ? tick.beat + 1 : '…'} de ${beats}`
                : `Calibrando: toque junto com o clique (${Math.min(CAL_BEATS, (tick?.note ?? 0) + 1)} de ${CAL_BEATS})`
              : countIn
                ? `Contagem: ${tick ? tick.beat + 1 : '…'} de ${beats}`
                : silentNow
                  ? 'Sem clique: continue no tempo'
                  : running && offbeat
                    ? 'Contratempo: toque no meio, entre os cliques'
                    : running && ladderBars
                      ? `Escada: ${shownNps} ${shownNps === 1 ? 'nota' : 'notas'} por tempo`
                      : ''}
          </p>
        </div>

        {/* BPM */}
        <div className="mt-4 flex items-center justify-center gap-2 sm:gap-3">
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
              onClick={() => {
                setNps(n)
                setLadderBars(0)
              }}
              aria-pressed={!ladderBars && nps === n}
              className={`btn btn-round px-3 py-1.5 text-sm ${!ladderBars && nps === n ? 'btn-primary' : ''}`}
            >
              {NPS_LABEL[n]}
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-col items-center gap-2">
          <button
            onClick={toggle}
            disabled={calibrating}
            className={`btn btn-round min-w-48 px-6 py-3 text-base ${running ? 'btn-danger' : 'btn-primary'}`}
          >
            {running ? '■ Parar' : record ? '● Começar e gravar' : '▶ Começar (sem gravar)'}
          </button>
          {running && recording && <span className="text-xs text-rose-300">● gravando: ao parar, o resultado aparece embaixo</span>}
          {error && <p className="text-center text-sm text-rose-300">{error}</p>}
        </div>

        {suggestUp && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3 rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm text-emerald-100">
            Você acertou {Math.round(stats!.hitPct)}% (≥ {progressionLimit}%). Hora de subir para {clampBpm(bpm + PROGRESSION_STEP)} BPM?
            <button onClick={() => setBpm(clampBpm(bpm + PROGRESSION_STEP))} className="btn btn-primary btn-round px-4 py-1.5">
              Subir {PROGRESSION_STEP} BPM
            </button>
          </div>
        )}

        <p className="mt-4 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          🎧 Use fone de ouvido (de preferência com fio): assim o microfone escuta só o violão, e não o clique do metrônomo. Se o
          microfone captar o clique mesmo assim, o app tenta ignorá-lo.
        </p>

        <details className="mt-4 rounded-xl border border-line bg-black/20 p-3 text-sm text-slate-300">
          <summary className="cursor-pointer font-semibold text-slate-200">Mais opções</summary>
          <div className="mt-3 space-y-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <label className="flex items-center gap-2">
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
              <label className="flex items-center gap-2">
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
              <Check checked={record} onChange={setRecord} label="Gravar e medir" />
              <Check checked={subClicks} onChange={setSubClicks} label="Clique nas divisões" />
            </div>

            <Option title="Modo escada" hint="Começa com 1 nota por tempo e passa para 2, 3 e 4 a cada N compassos (depois volta ao 1). A grade do d3lay acompanha.">
              <select
                value={ladderBars}
                onChange={(e) => setLadderBars(Number(e.target.value))}
                className="rounded-lg border border-line bg-panel px-2 py-1 text-white"
              >
                <option value={0}>desligado</option>
                {[1, 2, 4, 8].map((n) => (
                  <option key={n} value={n}>
                    muda a cada {n} {n === 1 ? 'compasso' : 'compassos'}
                  </option>
                ))}
              </select>
            </Option>

            <Option
              title="Metrônomo esparso"
              hint="Os tempos sem clique continuam valendo para o d3lay. O resultado mostra os trechos com e sem clique separados."
            >
              <div className="flex flex-wrap items-center gap-2">
                <Check checked={firstBeatOnly} onChange={setFirstBeatOnly} label="Clicar só no tempo 1" />
                <span className="flex items-center gap-1">
                  Silenciar
                  <select
                    value={muteBars}
                    onChange={(e) => setMuteBars(Number(e.target.value))}
                    className="rounded-lg border border-line bg-panel px-2 py-1 text-white"
                  >
                    {[0, 1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? 'nenhum' : n}
                      </option>
                    ))}
                  </select>
                  {muteBars > 0 && (
                    <>
                      {muteBars === 1 ? 'compasso' : 'compassos'} a cada
                      <select
                        value={muteEvery}
                        onChange={(e) => setMuteEvery(Number(e.target.value))}
                        className="rounded-lg border border-line bg-panel px-2 py-1 text-white"
                      >
                        {[2, 3, 4, 6, 8].filter((m) => m > muteBars).map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </span>
              </div>
            </Option>

            <Option title="Contratempo" hint="O alvo passa a ser o meio de cada divisão (o &quot;e&quot;), e não o clique.">
              <Check checked={offbeat} onChange={setOffbeat} label="Tocar no contratempo" />
            </Option>

            <Option title="Progressão de BPM" hint="Comece devagar; quando a % de acerto passar do limite, o app sugere subir 5 BPM.">
              <div className="flex flex-wrap items-center gap-2">
                <Check checked={progression} onChange={setProgression} label="Ligada" />
                {progression && (
                  <>
                    <span className="flex items-center gap-1">
                      limite
                      <input
                        type="number"
                        min={50}
                        max={100}
                        value={progressionLimit}
                        onChange={(e) => e.target.value !== '' && setProgressionLimit(Math.max(50, Math.min(100, Number(e.target.value))))}
                        className="w-16 rounded-lg border border-line bg-transparent px-2 py-1 text-center text-white"
                        aria-label="Limite de acerto para subir o BPM"
                      />
                      %
                    </span>
                    <button onClick={() => setBpm(PROGRESSION_START)} className="btn btn-round px-3 py-1 text-xs">
                      Começar do {PROGRESSION_START} BPM
                    </button>
                  </>
                )}
              </div>
            </Option>

            <Option
              title="Latência"
              hint="O fone e o microfone atrasam o som alguns milissegundos (fone Bluetooth atrasa muito mais). Sem descontar isso, todo d3lay teria um erro fixo."
            >
              <LatencyField auto={(take?.autoLatency ?? 0) * 1000} adjust={latencyAdjust} onAdjust={setLatencyAdjust} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button onClick={() => void start(true)} disabled={running} className="btn btn-round px-3 py-1.5 text-xs">
                  {calibrating ? 'Calibrando…' : 'Calibrar (8 batidas)'}
                </button>
                <span className="text-xs text-slate-500">
                  Com o fone que você vai usar, toque uma nota abafada junto com cada clique, 8 vezes.
                </span>
              </div>
              {calMsg && <p className="mt-2 text-xs text-emerald-300">{calMsg}</p>}
            </Option>
          </div>
        </details>

        <p className="mt-3 text-center text-xs text-slate-500">
          Antes de começar, o metrônomo conta 1 compasso (não é medido). O 1º tempo soa mais agudo. Barra de espaço liga e desliga.
        </p>
      </section>

      <div ref={resultsRef} className="scroll-mt-4">
        {take && !take.meta.calibration && (
          <section className="mt-4 rounded-2xl border border-line bg-panel/80 p-3 backdrop-blur sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-xl font-bold">Resultado</h2>
              <span className="text-xs text-slate-400">
                {take.meta.exerciseName} · {take.meta.bpm} BPM ·{' '}
                {take.meta.nps === 0 ? 'escada' : `${take.meta.nps} por tempo`}
                {take.meta.tags.length ? ` · ${take.meta.tags.join(', ')}` : ''}
              </span>
            </div>
            <RhythmResults
              samples={take.samples}
              sampleRate={take.sampleRate}
              analysis={analysis}
              analyzing={analyzing}
              tolerance={tolerance}
              onTolerance={setTolerance}
              sensitivity={sensitivity}
              onSensitivity={setSensitivity}
              autoLatencyMs={take.autoLatency * 1000}
              latencyAdjust={latencyAdjust}
              onLatencyAdjust={setLatencyAdjust}
              offbeat={take.meta.offbeat}
            />
          </section>
        )}
      </div>

      <RhythmHistory sessions={allSessions} currentExercise={currentExerciseId} onDelete={removeSession} />
    </>
  )
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
      {label}
    </label>
  )
}

function Option({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-3">
      <div className="font-semibold text-slate-200">{title}</div>
      <p className="mb-2 text-xs text-slate-500">{hint}</p>
      {children}
    </div>
  )
}
