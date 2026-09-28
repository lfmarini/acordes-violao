// Peças compartilhadas pelos testes de reconhecimento: som de violão
// sintetizado (o mesmo modelo de corda do play) e a análise do som em
// quadros, como o microfone faria.
import { Note } from 'tonal'
import { synthPluck } from '../src/lib/ks'
import { analyzeSpectrum, type Frame } from '../src/lib/recognize'
import { noteAt } from '../src/lib/theory'

export const sr = 48000
export const N = 16384

export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k)
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
      }
  }
}

/** Violão tocando as casas dadas (−1 = corda não tocada), com um pouco de ruído. */
export function render(frets: number[], noise: number) {
  const out = new Float32Array(sr * 2.2)
  let k = 0
  frets.forEach((f, s) => {
    if (f < 0) return
    const hz = 440 * Math.pow(2, (Note.midi(noteAt(s, f))! - 69) / 12)
    const buf = synthPluck({ freq: hz, sampleRate: sr, duration: 2.1, t60: 4 - s * 0.35, seed: s + f * 7 })
    const off = Math.floor(k++ * 0.032 * sr)
    for (let i = 0; i < buf.length && i + off < out.length; i++) out[i + off] += buf[i] * 0.3
  })
  for (let i = 0; i < out.length; i++) out[i] += (Math.random() - 0.5) * noise
  return out
}

/** Quadros de análise a cada `hop` amostras: o espectro analisado e o volume (dBFS). */
export function* frames(audio: Float32Array, hop = 4096, from = 0.15): Generator<{ frame: Frame; db: number; t: number }> {
  for (let start = Math.floor(from * sr); start + N < audio.length; start += hop) {
    const re = new Float64Array(N), im = new Float64Array(N)
    let s = 0
    for (let i = 0; i < N; i++) {
      const v = audio[start + i]
      s += v * v
      re[i] = v * (0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N))
    }
    fft(re, im)
    const mag = new Float32Array(N / 2)
    for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]) / N
    const db = Math.max(-60, 20 * Math.log10(Math.max(Math.sqrt(s / N), 1e-6)))
    yield { frame: analyzeSpectrum(mag, sr, N), db, t: start / sr }
  }
}
