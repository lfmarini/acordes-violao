/// <reference lib="webworker" />
import { analyzeTake, type AnalysisOptions, type Take } from './rhythmAnalysis'

// ---------------------------------------------------------------------------
// Análise do treino de ritmo num "worker" (linha de execução separada), para
// a tela não travar em gravações longas. A gravação chega uma vez ("load");
// depois cada mudança de sensibilidade ou latência pede uma nova análise.
// ---------------------------------------------------------------------------

type Msg = { type: 'load'; take: Take } | { type: 'analyze'; id: number; options: AnalysisOptions }

let take: Take | null = null

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data
  if (m.type === 'load') {
    take = m.take
    return
  }
  if (!take) return
  try {
    const result = analyzeTake(take, m.options)
    self.postMessage({ id: m.id, result })
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err) })
  }
}
