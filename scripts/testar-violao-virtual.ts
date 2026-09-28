// Testa quantas notas o violão virtual acende sem ninguém tocá-las.
// Sintetiza notas soltas e acordes (mesmo modelo de corda do play), analisa
// como o microfone faria (um quadro a cada ~85 ms) e compara as notas acesas
// com as tocadas, na regra antiga e na nova. Rode com: npm run violao
import { Note } from 'tonal'
import { shapesFor } from '../src/lib/chords'
import { LIVE_GATE_DB, LiveDetector } from '../src/lib/liveDetect'
import { pickNotes } from '../src/lib/liveNotes'
import { parseChord } from '../src/lib/parser'
import type { Frame } from '../src/lib/recognize'
import { noteAt } from '../src/lib/theory'
import { frames, render, sr } from './audio-sintetico'

// Regra antiga (como estava no quadro de amplitude), para comparar.
function oldNotes(frame: Frame): number[] {
  const strongest = Math.max(0, ...frame.fundamentals.map((n) => n.strength))
  const out = new Set<number>()
  for (const n of frame.fundamentals) {
    if (n.strength < strongest * 0.45 || n.f < 75 || n.f > 1400) continue
    const midi = 69 + 12 * Math.log2(n.f / 440)
    if (Math.abs(midi - Math.round(midi)) <= 0.3) out.add(Math.round(midi))
  }
  return [...out]
}

type Case = { name: string; frets: number[] }
const cases: Case[] = [
  // Notas soltas em cordas diferentes.
  { name: 'E2 (6ª solta)', frets: [0, -1, -1, -1, -1, -1] },
  { name: 'A2 (5ª solta)', frets: [-1, 0, -1, -1, -1, -1] },
  { name: 'D3 (4ª solta)', frets: [-1, -1, 0, -1, -1, -1] },
  { name: 'G3 (3ª solta)', frets: [-1, -1, -1, 0, -1, -1] },
  { name: 'C4 (2ª casa 1)', frets: [-1, -1, -1, -1, 1, -1] },
  { name: 'E4 (1ª solta)', frets: [-1, -1, -1, -1, -1, 0] },
  { name: 'A4 (1ª casa 5)', frets: [-1, -1, -1, -1, -1, 5] },
  // Acordes (primeira forma de cada um).
  ...['C', 'G', 'D', 'Am', 'Em', 'E', 'A', 'Dm', 'F', 'G7'].map((n) => {
    const r = parseChord(n)
    return { name: n, frets: r.ok ? shapesFor(r.chord)[0].frets : [] }
  }),
]

/**
 * "Microfone de celular": corta os graves (filtro de 2ª ordem em ~250 Hz,
 * como os microfones pequenos), soma zumbido da rede elétrica (60 Hz e
 * harmônicos) e mais ruído. É aqui que aparecem as notas falsas.
 */
function phoneMic(audio: Float32Array) {
  const out = new Float32Array(audio.length)
  const rc = 1 / (2 * Math.PI * 250)
  const a = rc / (rc + 1 / sr)
  // Dois passa-altas de 1ª ordem em sequência = um de 2ª ordem (corta mais os graves).
  let x1 = 0, y1 = 0, y1prev = 0, y2 = 0
  for (let i = 0; i < audio.length; i++) {
    const x = audio[i]
    y1 = a * (y1 + x - x1)
    x1 = x
    y2 = a * (y2 + y1 - y1prev)
    y1prev = y1
    const t = i / sr
    const hum = 0.004 * Math.sin(2 * Math.PI * 60 * t) + 0.003 * Math.sin(2 * Math.PI * 120 * t) + 0.002 * Math.sin(2 * Math.PI * 180 * t)
    out[i] = y2 * 1.5 + hum + (Math.random() - 0.5) * 0.01
  }
  return out
}

const sound = { limpo: (c: Case) => render(c.frets, 0.002), celular: (c: Case) => phoneMic(render(c.frets, 0.002)) }

function run(c: Case, rule: 'antiga' | 'nova', mic: keyof typeof sound) {
  const played = new Set(c.frets.flatMap((f, s) => (f < 0 ? [] : [Note.midi(noteAt(s, f))!])))
  const detector = new LiveDetector()
  const lit = new Set<number>()
  let prev = new Set<number>()
  let last = 0
  for (const { frame, db, t } of frames(sound[mic](c), 4096, 0)) {
    const dt = last ? t - last : 4096 / sr
    last = t
    const result = detector.update(frame, db, dt)
    const now = db >= LIVE_GATE_DB ? (rule === 'nova' ? pickNotes(frame, result) : oldNotes(frame)) : []
    // Como no app: só vale a nota que aparece em duas análises seguidas.
    for (const m of now) if (prev.has(m)) lit.add(m)
    prev = new Set(now)
  }
  const extra = [...lit].filter((m) => !played.has(m))
  const found = [...played].filter((m) => lit.has(m))
  return { extra, found: found.length, played: played.size }
}

const name = (m: number) => Note.fromMidiSharps(m)
let fails = 0
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '✔' : '✘'} ${msg}`)
  if (!ok) fails++
}

for (const mic of ['limpo', 'celular'] as const) {
  const total = { antiga: { extra: 0, found: 0 }, nova: { extra: 0, found: 0 } }
  let playedTotal = 0
  console.log(`\n=== som ${mic} ===`)
  console.log('caso'.padEnd(16), 'regra antiga (notas a mais)'.padEnd(44), 'regra nova (notas a mais)')
  for (const c of cases) {
    const a = run(c, 'antiga', mic)
    const b = run(c, 'nova', mic)
    playedTotal += a.played
    total.antiga.extra += a.extra.length
    total.antiga.found += a.found
    total.nova.extra += b.extra.length
    total.nova.found += b.found
    const fmt = (r: typeof a) => `${r.extra.length} ${r.extra.length ? `(${r.extra.map(name).join(' ')})` : ''} · achou ${r.found}/${r.played}`
    console.log(c.name.padEnd(16), fmt(a).padEnd(44), fmt(b))
  }
  console.log(`notas a mais no total: antiga ${total.antiga.extra} · nova ${total.nova.extra}`)
  console.log(`notas tocadas encontradas: antiga ${total.antiga.found}/${playedTotal} · nova ${total.nova.found}/${playedTotal}`)
  check(total.nova.extra <= Math.max(1, total.antiga.extra / 3), `${mic}: a regra nova acende bem menos notas que não foram tocadas`)
  check(total.nova.found >= total.antiga.found * 0.85, `${mic}: e acha quase tantas notas tocadas quanto antes`)
}
process.exit(fails ? 1 : 0)
