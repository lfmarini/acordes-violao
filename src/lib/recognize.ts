import { Chord, Note } from 'tonal'
import { QUALITIES, ROOTS, type ChordRef, type Quality } from './chords'

// ---------------------------------------------------------------------------
// Reconhecimento de acorde pelo som (o "Shazam" do app).
//
// 1. O microfone entrega o espectro do som (quanto de cada frequência há).
// 2. Achamos os picos do espectro: cada nota tocada vira um pico na sua
//    frequência e outros picos menores nos harmônicos (2x, 3x, 4x, 5x...).
// 3. Os harmônicos 3x e 5x enganam: o 5º harmônico do Lá é um Dó#, e isso
//    faria o Am parecer A maior. Por isso reduzimos o peso de picos que são
//    3x, 5x ou 6x a frequência de um pico mais grave e forte.
// 4. Somamos a energia de cada pico na sua nota, ignorando a oitava
//    (é o "cromagrama": 12 caixinhas, uma para cada nota C, C#, D...).
// 5. Comparamos o cromagrama com o "molde" de cada acorde (as notas que ele
//    tem) e ficamos com os mais parecidos. A nota mais grave (o baixo) ajuda
//    a desempatar acordes com as mesmas notas, como C6 e Am7.
// ---------------------------------------------------------------------------

export const MIN_HZ = 70 // um pouco abaixo do E2 (82 Hz)
export const MAX_HZ = 2000
// Uma nota conta como "presente" se tiver ao menos 18% da força da mais forte.
const PRESENT = 0.18

export interface Frame {
  chroma: number[] // 12 posições, C = 0
  bass: number[] // idem, só para a nota mais grave
  energy: number
  /** Notas (fundamentais) encontradas: frequência e força. */
  fundamentals: { f: number; strength: number }[]
}

interface Peak {
  f: number
  amp: number
  w: number
}

/** Converte um espectro (magnitudes lineares) em cromagrama. */
export function analyzeSpectrum(mag: Float32Array, sampleRate: number, fftSize: number): Frame {
  const binHz = sampleRate / fftSize
  const k0 = Math.max(2, Math.floor(MIN_HZ / binHz))
  const k1 = Math.min(mag.length - 2, Math.ceil(MAX_HZ / binHz))

  let max = 0
  for (let k = k0; k <= k1; k++) max = Math.max(max, mag[k])
  const chroma = new Array(12).fill(0)
  const bass = new Array(12).fill(0)
  if (max <= 0) return { chroma, bass, energy: 0, fundamentals: [] }

  // Picos locais acima de 4% do maior.
  let peaks: Peak[] = []
  for (let k = k0; k <= k1; k++) {
    const m = mag[k]
    if (m < max * 0.04 || m <= mag[k - 1] || m < mag[k + 1]) continue
    // Interpolação parabólica para achar a frequência entre dois "bins".
    const a = mag[k - 1], b = m, c = mag[k + 1]
    const d = a - 2 * b + c
    const shift = d === 0 ? 0 : (0.5 * (a - c)) / d
    peaks.push({ f: (k + shift) * binHz, amp: m, w: 1 })
  }
  peaks = peaks.sort((p, q) => q.amp - p.amp).slice(0, 48).sort((p, q) => p.f - q.f)

  // Separação de fundamentais e harmônicos: indo do grave para o agudo, cada
  // pico que for múltiplo inteiro (2x, 3x... 12x) de uma nota já aceita é
  // um harmônico dela — sua energia reforça essa nota em vez de virar outra.
  // Os que não se explicam assim são notas tocadas de verdade.
  const notes: Peak[] = []
  for (const p of peaks) {
    const owner = notes.find((q) => {
      const ratio = p.f / q.f
      const n = Math.round(ratio)
      return n >= 2 && n <= 12 && Math.abs(ratio - n) / n < 0.015
    })
    if (owner) owner.w += Math.sqrt(p.amp) / Math.sqrt(owner.amp) * 0.5
    else notes.push({ ...p })
  }

  let energy = 0
  for (const p of notes) {
    const midi = 69 + 12 * Math.log2(p.f / 440)
    const near = Math.round(midi)
    // Longe demais de uma nota da escala temperada: harmônico "torto" (7x, 11x...) ou ruído.
    if (Math.abs(midi - near) > 0.25) continue
    const pc = ((near % 12) + 12) % 12
    chroma[pc] += Math.sqrt(p.amp) * p.w
    energy += p.amp
  }

  // Baixo: a nota mais grave com força razoável.
  const low = notes.find((p) => p.f < 340 && Math.sqrt(p.amp) * p.w > Math.sqrt(max) * 0.35)
  if (low) {
    const pc = ((Math.round(69 + 12 * Math.log2(low.f / 440)) % 12) + 12) % 12
    bass[pc] += 1
  }
  const fundamentals = notes.map((p) => ({ f: p.f, strength: Math.sqrt(p.amp) * p.w }))
  return { chroma, bass, energy, fundamentals }
}

// Qualidades que o reconhecedor considera (as mais comuns no violão).
const CANDIDATE_IDS = ['maior', 'menor', '7', '7M', 'm7', '6', 'm6', 'sus2', 'sus4', '7sus4', 'dim', 'dim7', 'm7b5', 'aug', 'add9', '9']
const CANDIDATES: Quality[] = QUALITIES.filter((q) => CANDIDATE_IDS.includes(q.id))

const TEMPLATES = ROOTS.flatMap((r) =>
  CANDIDATES.map((q) => {
    const pcs = new Set(Chord.get(r.name + q.tonal).notes.map((n) => Note.chroma(n) ?? 0))
    return { ref: { root: r.name, quality: q } as ChordRef, rootPc: Note.chroma(r.name) ?? 0, pcs }
  }),
)

export interface Guess {
  chord: ChordRef
  score: number // 0..1, quanto o som bate com o molde
  notes: string[] // notas ouvidas que pertencem ao acorde
}

/** Ordena os acordes do mais provável ao menos provável. */
export function rankChords(chroma: number[], bass: number[], limit = 3): Guess[] {
  const top = Math.max(...chroma) || 1
  const c = chroma.map((v) => v / top) // 0..1: a nota mais forte vale 1
  const total = c.reduce((a, b) => a + b, 0) || 1
  const bassTotal = bass.reduce((a, b) => a + b, 0)
  const bassPc = bassTotal > 0 ? bass.indexOf(Math.max(...bass)) : -1

  return TEMPLATES.map((t) => {
    // Energia explicada pelo acorde menos a que sobra fora dele...
    let inside = 0
    let missing = 0
    for (const pc of t.pcs) {
      inside += c[pc]
      if (c[pc] < PRESENT) missing++ // ...e cada nota do molde que não soou pesa contra.
    }
    let score = (inside - (total - inside)) / total - 0.12 * missing
    if (t.rootPc === bassPc) score += 0.08 // o baixo costuma ser a tônica
    score -= 0.01 * (t.pcs.size - 3) // no empate, prefere o acorde mais simples
    const notes = [...t.pcs].filter((pc) => c[pc] >= PRESENT).map((pc) => PC_NAMES[pc])
    return { chord: t.ref, score: Math.max(0, Math.min(1, score)), notes }
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export const PC_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
