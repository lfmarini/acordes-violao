import { useCallback, useRef, useState } from 'react'
import type { ChordRef } from '../lib/chords'
import type { LiveResult } from '../lib/liveDetect'
import { MAX_RECORD_MIN } from '../lib/recorder'
import { AmplitudeChart, type BeatMark } from './AmplitudeChart'
import { HIT_FADE_MS, LiveFretboard } from './LiveFretboard'
import { MetronomePanel } from './MetronomePanel'

// Aba "Aprendizado": metrônomo e gráfico de amplitude, lado a lado no
// computador e um embaixo do outro no celular; embaixo, o braço inteiro com
// as notas que o microfone identifica. As batidas do metrônomo
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

  // Notas ouvidas pelo microfone: nota MIDI -> última vez que soou.
  const [heard, setHeard] = useState({ hits: new Map<number, number>(), live: { kind: 'silence' } as LiveResult, now: 0, on: false })
  const onNotes = useCallback((midis: number[], live: LiveResult, micOn = true) => {
    const now = performance.now()
    setHeard((h) => {
      const hits = new Map([...h.hits].filter(([, at]) => now - at < HIT_FADE_MS))
      for (const m of midis) hits.set(m, now)
      return { hits, live, now, on: micOn }
    })
  }, [])

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
      <MetronomePanel onBeat={onBeat} active={active} />
      <AmplitudeChart beats={beats} active={active} onPick={onPick} onNotes={onNotes} />
      <div className="lg:col-span-2">
        <LiveFretboard hits={heard.hits} live={heard.live} now={heard.now} on={heard.on} />
      </div>
    </div>
  )
}
