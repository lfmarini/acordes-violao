import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Chord, Note } from 'tonal'
import { trackFromAnalysis } from '../src/lib/audioAnalysis'
import { runAnalysis } from '../src/lib/essentiaPipeline'
import { songChordName } from '../src/lib/songChords'
import { BARS, BEAT, BPM } from './exemplo-musica'

// Teste de verdade da análise de áudio (Essentia.js): sintetiza os primeiros
// compassos da música de exemplo (acordes + batida) e roda a mesma receita
// do Web Worker. O analisador só conhece acordes maiores e menores, então
// comparamos só a "tríade" de cada acorde (G7M -> G, Am7 -> Am).

const require = createRequire(import.meta.url)
// No Node usamos a entrada do próprio pacote (como na documentação do essentia.js).
const { Essentia, EssentiaWASM } = require('essentia.js')

const SR = 44100
const N_BARS = 24
const LEAD = 1 // s de silêncio antes
const bar = BEAT * 4
const total = Math.ceil((LEAD + N_BARS * bar + 1) * SR)
const out = new Float32Array(total)

// Acorde: cada nota com 4 harmônicos e ataque de violão; baixo uma oitava abaixo.
function addNote(midi: number, start: number, dur: number, amp: number) {
  const f = 440 * Math.pow(2, (midi - 69) / 12)
  const i0 = Math.floor(start * SR)
  const n = Math.floor(dur * SR)
  for (let i = 0; i < n && i0 + i < total; i++) {
    const t = i / SR
    const env = Math.min(1, t / 0.005) * Math.exp(-t * 1.2)
    let v = 0
    for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * f * h * t) / (h * h)
    out[i0 + i] += v * env * amp
  }
}
function addKick(start: number) {
  const i0 = Math.floor(start * SR)
  for (let i = 0; i < SR * 0.12 && i0 + i < total; i++) {
    const t = i / SR
    out[i0 + i] += Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-t * 40)) * t) * Math.exp(-t * 25) * 0.6
  }
}

const expected: string[] = []
BARS.slice(0, N_BARS).forEach((b, i) => {
  b.forEach(([name, beat], k) => {
    const start = LEAD + i * bar + beat * BEAT
    const end = LEAD + i * bar + (b[k + 1]?.[1] ?? 4) * BEAT
    const [main] = name.split('/')
    const c = Chord.get(main)
    const triad = c.notes[0] + (c.intervals.includes('3m') ? 'm' : '')
    if (expected[expected.length - 1] !== triad) expected.push(triad)
    for (const n of c.notes.slice(0, 3)) addNote(Note.midi(n + '4')!, start, end - start, 0.12)
    addNote(Note.midi(c.notes[0] + '2')!, start, end - start, 0.18)
  })
  for (let k = 0; k < 4; k++) addKick(LEAD + i * bar + k * BEAT)
})

// Guarda o áudio (WAV 16 bits) para testar a análise no app.
const wav = Buffer.alloc(44 + total * 2)
wav.write('RIFF', 0)
wav.writeUInt32LE(36 + total * 2, 4)
wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20)
wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(SR, 24)
wav.writeUInt32LE(SR * 2, 28)
wav.writeUInt16LE(2, 32)
wav.writeUInt16LE(16, 34)
wav.write('data', 36)
wav.writeUInt32LE(total * 2, 40)
for (let i = 0; i < total; i++) wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i])) * 0x7fff), 44 + i * 2)
mkdirSync('scripts/exemplo', { recursive: true })
writeFileSync('scripts/exemplo/exemplo-audio.wav', wav)

console.log(`Analisando ${(total / SR).toFixed(0)} s de áudio sintetizado…`)
const t0 = performance.now()
const r = runAnalysis(Essentia, EssentiaWASM, out, () => {})
console.log(`  levou ${((performance.now() - t0) / 1000).toFixed(1)} s`)
const track = trackFromAnalysis(r, total / SR)
const got = track.chords.map((c) => songChordName(c.chord))

// Acerto: fração dos acordes esperados que aparecem na mesma ordem.
let j = 0
for (const g of got) if (g === expected[j]) j++
const ok = j / expected.length
console.log(`  BPM: ${r.bpm.toFixed(1)} (esperado ${BPM}) · tom: ${track.key.name} · batidas: ${r.ticks.length}`)
console.log(`  esperado: ${expected.join(' ')}`)
console.log(`  achado:   ${got.join(' ')}`)
console.log(`  acordes na ordem certa: ${Math.round(ok * 100)}%`)

let fails = 0
const check = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`)
  if (!cond) fails++
}
check(Math.abs(r.bpm - BPM) < 3 || Math.abs(r.bpm - 2 * BPM) < 5 || Math.abs(r.bpm - BPM / 2) < 3, 'BPM perto do certo (ou o dobro/metade)')
check(track.key.name === 'G' || track.key.name === 'Em', `tom G (ou o relativo Em): ${track.key.name}`)
check(ok >= 0.7, 'pelo menos 70% dos acordes reconhecidos na ordem')
process.exit(fails ? 1 : 0)
