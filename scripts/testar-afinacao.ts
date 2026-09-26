// Confere a afinação do som sintetizado: gera cada nota e mede a frequência.
// Rode com: npm run afinacao
import { Note } from 'tonal'
import { OPEN_STRINGS } from '../src/lib/chords'
import { synthPluck } from '../src/lib/ks'
import { noteAt } from '../src/lib/theory'

const sr = 48000
function measure(buf: Float32Array, expected: number) {
  // Autocorrelação numa janela do meio do som, perto do período esperado.
  const start = Math.floor(0.3 * sr)
  const size = Math.floor(0.25 * sr)
  const p0 = sr / expected
  let best = 0
  let bestLag = 0
  const score = (lag: number) => {
    let s = 0
    for (let i = 0; i < size; i++) s += buf[start + i] * buf[start + i + lag]
    return s
  }
  for (let lag = Math.floor(p0 * 0.9); lag <= Math.ceil(p0 * 1.1); lag++) {
    const s = score(lag)
    if (s > best) [best, bestLag] = [s, lag]
  }
  const a = score(bestLag - 1), b = best, c = score(bestLag + 1)
  const lag = bestLag + (0.5 * (a - c)) / (a - 2 * b + c)
  return sr / lag
}

const hz = (n: string) => 440 * Math.pow(2, (Note.midi(n)! - 69) / 12)
const rows: string[] = []
for (let s = 0; s < 6; s++) {
  for (const fret of [0, 5, 12]) {
    const n = noteAt(s, fret)
    const f = hz(n)
    const got = measure(synthPluck({ freq: f, sampleRate: sr, duration: 1 }), f)
    const cents = 1200 * Math.log2(got / f)
    rows.push(`${OPEN_STRINGS[s]} casa ${String(fret).padStart(2)} -> ${n.padEnd(4)} ${f.toFixed(2).padStart(7)} Hz  medido ${got.toFixed(2).padStart(7)} Hz  (${cents >= 0 ? '+' : ''}${cents.toFixed(1)} cents)`)
  }
}
console.log(rows.join('\n'))
