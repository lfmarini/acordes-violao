import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChordRef } from '../lib/chords'
import type { LiveResult } from '../lib/liveDetect'
import { MAX_RECORD_MIN } from '../lib/recorder'
import { AmplitudeChart, type BeatMark } from './AmplitudeChart'
import { LiveFretboard } from './LiveFretboard'
import { MetronomePanel } from './MetronomePanel'

/** Limites do tempo que a nota fica no violão virtual (ms). */
const MIN_FADE_MS = 800
const MAX_FADE_MS = 6000

// Aba "Aprendizado": metrônomo e gráfico de amplitude, lado a lado no
// computador e um embaixo do outro no celular. O "violão virtual" (o braço
// inteiro com as notas que o microfone identifica) fica dentro do quadro de
// amplitude, logo acima de "Salvar gravação". As batidas do metrônomo
// são repassadas ao gráfico para aparecerem como linhas verticais.
export function Learning({ active, onPick }: { active: boolean; onPick: (c: ChordRef) => void }) {
  const beats = useRef<BeatMark[]>([])
  const onBeat = useCallback((beat: number, at: number) => {
    // Guardamos as batidas pelo mesmo tempo da gravação, para poder mistura-las no arquivo.
    const keep = MAX_RECORD_MIN * 60 * 1000
    const list = beats.current
    while (list.length && at - list[0].at > keep) list.shift()
    list.push({ at, accent: beat === 0 })
  }, [])

  // Quanto a nota fica no violão virtual: um compasso do metrônomo
  // (tempos do compasso × duração de um tempo), entre 0,8 s e 6 s.
  const [tempo, setTempo] = useState({ bpm: 120, beats: 4 })
  const onTempo = useCallback((bpm: number, beats: number) => setTempo({ bpm, beats }), [])
  const fadeMs = Math.round(Math.min(MAX_FADE_MS, Math.max(MIN_FADE_MS, (tempo.beats * 60000) / tempo.bpm)))
  const fadeHint = `1 compasso de ${tempo.beats} ${tempo.beats === 1 ? 'tempo' : 'tempos'} a ${tempo.bpm} BPM`
  const fadeRef = useRef(fadeMs)
  useEffect(() => {
    fadeRef.current = fadeMs
  }, [fadeMs])

  // Notas ouvidas pelo microfone: nota MIDI -> última vez que soou.
  const [heard, setHeard] = useState({ hits: new Map<number, number>(), now: 0, on: false })
  // Ao parar o microfone, o metrônomo também para.
  const [stopMetronome, setStopMetronome] = useState(0)
  const onNotes = useCallback((midis: number[], _live: LiveResult, micOn = true) => {
    const now = performance.now()
    setHeard((h) => {
      const hits = new Map([...h.hits].filter(([, at]) => now - at < fadeRef.current))
      for (const m of midis) hits.set(m, now)
      return { hits, now, on: micOn }
    })
  }, [])

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
      <MetronomePanel onBeat={onBeat} active={active} onTempo={onTempo} stopSignal={stopMetronome} />
      <AmplitudeChart
        beats={beats}
        active={active}
        onPick={onPick}
        onNotes={onNotes}
        onUserStop={() => setStopMetronome((n) => n + 1)}
        beforeSave={<LiveFretboard hits={heard.hits} now={heard.now} on={heard.on} embedded fadeMs={fadeMs} fadeHint={fadeHint} />}
      />
    </div>
  )
}
