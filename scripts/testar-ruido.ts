// Testa a redução de ruído: um Lá (A2) sintetizado com chiado por cima.
// Mede quanto o chiado cai (trecho só de ruído) e quanto da nota sobra.
// Rode com: npm run ruido
import { DENOISE_WORKLET, noiseParams, type NoiseLevel } from '../src/lib/denoise'
import { synthPluck } from '../src/lib/ks'

const sr = 48000
type Proc = { process: (i: Float32Array[][], o: Float32Array[][]) => boolean; setLevel: (p: unknown) => void }
let Ctor: new () => Proc
;(globalThis as Record<string, unknown>).AudioWorkletProcessor = class { port = { onmessage: null } }
;(globalThis as Record<string, unknown>).registerProcessor = (_: string, c: new () => Proc) => (Ctor = c)
new Function(DENOISE_WORKLET)()

// 1 s de ruído, depois a nota por 2 s (com o mesmo ruído)
const len = sr * 3
const clean = new Float32Array(len)
const note = synthPluck({ freq: 110, sampleRate: sr, duration: 2, t60: 4 })
for (let i = 0; i < note.length; i++) clean[sr + i] = note[i] * 0.3
let seed = 7
const noise = new Float32Array(len).map(() => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.03)
const input = clean.map((v, i) => v + noise[i])

function run(level: NoiseLevel) {
  const p = new Ctor()
  p.setLevel(noiseParams(level))
  const out = new Float32Array(len)
  for (let i = 0; i < len; i += 128) {
    const o = new Float32Array(128)
    p.process([[input.subarray(i, i + 128)]], [[o]])
    out.set(o.subarray(0, Math.min(128, len - i)), i)
  }
  return out.subarray(1024) // descontamos o atraso de 1024 amostras
}
const rms = (a: Float32Array, from: number, to: number) => {
  let s = 0
  for (let i = from; i < to; i++) s += a[i] * a[i]
  return Math.sqrt(s / (to - from))
}
const db = (x: number) => (20 * Math.log10(x)).toFixed(1)
const noiseIn = rms(input, sr * 0.5, sr * 0.95)
const noteIn = rms(clean, sr * 1.05, sr * 1.8)
for (const level of [0, 15, 30, 50, 66, 80, 100] as NoiseLevel[]) {
  const out = run(level)
  const noiseOut = rms(out, sr * 0.5, sr * 0.95)
  // quanto da nota "limpa" sobrou: correlação com o sinal limpo
  let dot = 0, cc = 0
  for (let i = sr * 1.05; i < sr * 1.8; i++) { dot += out[i] * clean[i]; cc += clean[i] * clean[i] }
  console.log(`${String(level).padStart(3)}%  ruído ${db(noiseIn)} -> ${db(noiseOut)} dB (${db(noiseOut / noiseIn)} dB) · nota preservada ${(100 * dot / cc).toFixed(0)}% · nível da nota ${db(noteIn)} -> ${db(rms(out, sr * 1.05, sr * 1.8))} dB`)
}
