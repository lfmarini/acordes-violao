// Testa o reconhecedor: sintetiza cada forma de acorde (com o mesmo modelo de
// corda do play), analisa o som como o microfone faria e confere o palpite.
// Rode com: npm run reconhecimento
import { Note } from 'tonal'
import { chordDisplayName, shapesFor } from '../src/lib/chords'
import { synthPluck } from '../src/lib/ks'
import { parseChord } from '../src/lib/parser'
import { analyzeSpectrum, rankChords } from '../src/lib/recognize'
import { noteAt } from '../src/lib/theory'

const sr = 48000
const N = 16384

function fft(re: Float64Array, im: Float64Array) {
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

export function chromaOf(audio: Float32Array) {
  const chroma = new Array(12).fill(0), bass = new Array(12).fill(0)
  for (let start = Math.floor(0.15 * sr); start + N < audio.length; start += 4096) {
    const re = new Float64Array(N), im = new Float64Array(N)
    for (let i = 0; i < N; i++) re[i] = audio[start + i] * (0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N))
    fft(re, im)
    const mag = new Float32Array(N / 2)
    for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]) / N
    const fr = analyzeSpectrum(mag, sr, N)
    fr.chroma.forEach((v, i) => (chroma[i] += v))
    fr.bass.forEach((v, i) => (bass[i] += v))
  }
  return { chroma, bass }
}
function recognize(audio: Float32Array) {
  const { chroma, bass } = chromaOf(audio)
  return rankChords(chroma, bass)
}

if (process.env.DBG) {
  for (const [n, i] of JSON.parse(process.env.DBG) as [string, number][]) {
    const sh = shapesFor((parseChord(n) as { chord: never }).chord)[i]
    const { chroma, bass } = chromaOf(render(sh.frets, 0.002))
    const m = Math.max(...chroma)
    console.log(n, sh.label, chroma.map((v, k) => ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'][k] + ':' + (v / m).toFixed(2)).join(' '), 'bass', bass.map((v,k)=>v? k+':'+v:'').filter(Boolean).join(' '))
  }
  process.exit(0)
}
const list = ['C', 'Am', 'G7', 'F', 'C7M', 'Bm7b5', 'E9', 'D°', 'A+', 'Dsus4', 'Em', 'D', 'A', 'E', 'Dm', 'G', 'Bm', 'A7', 'E7', 'B7']
let ok = 0, total = 0, top3 = 0
for (const name of list) {
  const r = parseChord(name)
  if (!r.ok) continue
  for (const shape of shapesFor(r.chord).slice(0, 3)) {
    const guesses = recognize(render(shape.frets, 0.002))
    const want = chordDisplayName(r.chord)
    const got = guesses.map((g) => chordDisplayName(g.chord))
    // Enarmonia: comparamos pelas notas-base também (D#° = Eb°).
    const same = (n: string) => n === want || Note.chroma(n.match(/^[A-G][#b]?/)![0]) === Note.chroma(r.chord.root) && n.slice(n.match(/^[A-G][#b]?/)![0].length) === r.chord.quality.br
    total++
    if (same(got[0])) ok++
    if (got.some(same)) top3++
    if (!same(got[0])) console.log(`${want.padEnd(8)} ${shape.label.padEnd(10)} -> ${got.map((g, i) => `${g} ${(guesses[i].score * 100).toFixed(0)}%`).join(' | ')}`)
  }
}
console.log(`\nacertos no 1º palpite: ${ok}/${total} · entre os 3: ${top3}/${total}`)
