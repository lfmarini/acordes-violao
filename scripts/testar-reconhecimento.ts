// Testa o reconhecedor: sintetiza cada forma de acorde (com o mesmo modelo de
// corda do play), analisa o som como o microfone faria e confere o palpite.
// Rode com: npm run reconhecimento
import { Note } from 'tonal'
import { chordDisplayName, shapesFor } from '../src/lib/chords'
import { parseChord } from '../src/lib/parser'
import { rankChords } from '../src/lib/recognize'
import { frames, render } from './audio-sintetico'

export function chromaOf(audio: Float32Array) {
  const chroma = new Array(12).fill(0), bass = new Array(12).fill(0)
  for (const { frame: fr } of frames(audio)) {
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
