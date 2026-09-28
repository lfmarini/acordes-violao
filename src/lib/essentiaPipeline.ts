// ---------------------------------------------------------------------------
// Receita da análise de áudio com Essentia.js (licença AGPL-3.0). Fica
// separada do worker para rodar também nos testes (Node). Recebe o som em
// 44,1 kHz mono e devolve:
//  - BPM e o instante de cada batida (RhythmExtractor2013);
//  - o tom (KeyExtractor);
//  - o acorde entre cada par de batidas (HPCP por quadro + ChordsDetectionBeats).
// O ChordsDetectionBeats só reconhece acordes maiores e menores simples.
// ---------------------------------------------------------------------------

export interface AnalysisOutput {
  bpm: number
  ticks: number[]
  key: string
  scale: string
  chords: string[]
  strength: number[]
}

const SR = 44100
const FRAME = 4096
const HOP = 2048

/* eslint-disable @typescript-eslint/no-explicit-any */
export function runAnalysis(
  EssentiaCore: new (wasm: any) => any,
  wasm: any,
  samples: Float32Array,
  progress: (p: number, stage: string) => void,
): AnalysisOutput {
  progress(0.02, 'Preparando o analisador')
  const essentia = new EssentiaCore(wasm)
  const signal = essentia.arrayToVector(samples)

  progress(0.08, 'Procurando as batidas')
  const rhythm = essentia.RhythmExtractor2013(signal, 208, 'multifeature', 40)
  const ticks = Array.from(essentia.vectorToArray(rhythm.ticks) as Float32Array)

  progress(0.45, 'Descobrindo o tom')
  const key = essentia.KeyExtractor(signal, true, FRAME, HOP, 12, 3500, 60, 25, 0.2, 'bgate', SR)

  progress(0.55, 'Ouvindo os acordes')
  const frames = essentia.FrameGenerator(samples, FRAME, HOP)
  const pcp = new wasm.VectorVectorFloat()
  const total = frames.size()
  for (let i = 0; i < total; i++) {
    const w = essentia.Windowing(frames.get(i), true, FRAME, 'blackmanharris62')
    const sp = essentia.Spectrum(w.frame, FRAME)
    const pk = essentia.SpectralPeaks(sp.spectrum, 0.00001, 5000, 100, 40, 'magnitude', SR)
    const h = essentia.HPCP(pk.frequencies, pk.magnitudes, true, 500, 0, 5000, false, 40, false, 'unitMax', 440, SR, 12, 'squaredCosine', 1)
    pcp.push_back(h.hpcp)
    if (i % 200 === 0) progress(0.55 + 0.4 * (i / total), 'Ouvindo os acordes')
  }

  progress(0.96, 'Juntando tudo')
  const det = essentia.ChordsDetectionBeats(pcp, rhythm.ticks, 'interbeat_median', HOP, SR)
  const chords: string[] = []
  for (let i = 0; i < det.chords.size(); i++) chords.push(det.chords.get(i))
  const strength = Array.from(essentia.vectorToArray(det.strength) as Float32Array)
  signal.delete?.()
  pcp.delete?.()
  essentia.shutdown?.()
  return { bpm: rhythm.bpm, ticks, key: key.key, scale: key.scale, chords, strength }
}
