/// <reference lib="webworker" />
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js'
import Essentia from 'essentia.js/dist/essentia.js-core.es.js'
import { runAnalysis, type AnalysisOutput } from './essentiaPipeline'

// Análise de áudio num Web Worker, para não travar a tela (a receita está em
// essentiaPipeline.ts). Recebe o som em 44,1 kHz mono.

export interface AnalysisRequest {
  samples: Float32Array
}
export type AnalysisMessage = { progress: number; stage: string } | { result: AnalysisOutput } | { error: string }

const post = (m: AnalysisMessage) => (self as unknown as Worker).postMessage(m)

self.onmessage = (e: MessageEvent<AnalysisRequest>) => {
  try {
    const result = runAnalysis(Essentia, EssentiaWASM, e.data.samples, (progress, stage) => post({ progress, stage }))
    post({ result })
  } catch (err) {
    post({ error: err instanceof Error ? err.message : String(err) })
  }
}
