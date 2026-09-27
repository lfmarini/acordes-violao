import { useCallback, useRef } from 'react'
import { AmplitudeChart, type BeatMark } from './AmplitudeChart'
import { MetronomePanel } from './MetronomePanel'

// Aba "Aprendizado": metrônomo e gráfico de amplitude, lado a lado no
// computador e um embaixo do outro no celular. As batidas do metrônomo
// são repassadas ao gráfico para aparecerem como linhas verticais.
export function Learning({ active }: { active: boolean }) {
  const beats = useRef<BeatMark[]>([])
  const onBeat = useCallback((beat: number, at: number) => {
    beats.current = [...beats.current.filter((b) => at - b.at < 10000), { at, accent: beat === 0 }]
  }, [])

  return (
    <div className="grid gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
      <MetronomePanel onBeat={onBeat} active={active} />
      <AmplitudeChart beats={beats} active={active} />
    </div>
  )
}
