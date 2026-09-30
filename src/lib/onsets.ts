import { fft, hann } from './fft'

// ---------------------------------------------------------------------------
// Detecção de ataques (onsets) no som gravado, para o treino de ritmo.
//
// 1. O som é cortado em pedacinhos de ~21 ms, a cada ~5 ms. Em cada um, a
//    FFT diz quanto de cada frequência há.
// 2. "Fluxo espectral": somamos quanto cada frequência CRESCEU em relação ao
//    pedaço anterior. Uma nota nova faz muitas frequências crescerem de uma
//    vez, então aparece como um pico nessa curva.
// 3. Um pico vira ataque se passa de um limiar que acompanha o nível local
//    (mediana ao redor) mais uma margem. A "sensibilidade" regula essa
//    margem: quanto maior, mais ataques fracos entram.
// 4. Dois ataques a menos de `minGapMs` (padrão 50 ms) contam como um só.
// 5. O horário exato é refinado no próprio som: o instante em que o volume
//    começa a subir (resolução de 0,5 ms).
// ---------------------------------------------------------------------------

export interface OnsetOptions {
  /** 0 a 100 (padrão 50). Mais alto = pega ataques mais fracos (e mais ruído). */
  sensitivity?: number
  /** Intervalo mínimo entre dois ataques (ms). */
  minGapMs?: number
  /**
   * Diz se um candidato é barulho conhecido (ex.: o clique do metrônomo).
   * Esses voltam marcados com `ignored` e não bloqueiam um ataque logo depois.
   */
  ignore?: (time: number, strength: number) => boolean
}

export interface Onset {
  /** Segundos desde o início do áudio. */
  time: number
  /** Força do ataque (altura do pico do fluxo, relativa). */
  strength: number
  /** Marcado por `ignore` (não é ataque do violão). */
  ignored?: boolean
}

export const SENSITIVITY_DEFAULT = 50
export const MIN_GAP_MS = 50
/** Ataques abaixo deste volume (dBFS) são ignorados (ruído de fundo). */
const GATE_DB = -55

/** Curva do fluxo espectral: um valor a cada `hop` amostras. */
export function spectralFlux(x: Float32Array, sr: number) {
  const N = sr > 32000 ? 1024 : 512
  const hop = Math.round(sr * 0.005)
  const win = hann(N)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  const kLo = Math.max(1, Math.floor((60 * N) / sr))
  const kHi = Math.min(N / 2, Math.ceil((8000 * N) / sr))
  let prev = new Float64Array(N / 2)
  let cur = new Float64Array(N / 2)
  const frames = Math.max(0, Math.floor((x.length - N) / hop) + 1)
  const flux = new Float32Array(frames)
  const rmsDb = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    const off = f * hop
    let e = 0
    for (let i = 0; i < N; i++) {
      const v = x[off + i]
      e += v * v
      re[i] = v * win[i]
      im[i] = 0
    }
    rmsDb[f] = 10 * Math.log10(e / N + 1e-12)
    fft(re, im)
    let s = 0
    for (let k = kLo; k < kHi; k++) {
      // Compressão logarítmica: sons fracos e fortes pesam de forma parecida.
      cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]))
      const d = cur[k] - prev[k]
      if (d > 0) s += d
    }
    flux[f] = f === 0 ? 0 : s
    ;[prev, cur] = [cur, prev]
  }
  // Centro de cada pedaço, em amostras.
  return { flux, rmsDb, hop, N, center: (f: number) => f * hop + N / 2 }
}

// Volume (RMS) em janelas de 1 ms, a cada 0,5 ms.
function envelope(x: Float32Array, sr: number) {
  const step = Math.max(1, Math.round(sr * 0.0005))
  const w = step * 2
  const n = Math.floor(x.length / step)
  const env = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    const a = i * step
    const b = Math.min(x.length, a + w)
    for (let j = a; j < b; j++) s += x[j] * x[j]
    env[i] = Math.sqrt(s / Math.max(1, b - a))
  }
  return { env, step }
}

// Maior valor em volta de cada ponto (±w).
function slidingMax(a: Float32Array, w: number) {
  const out = new Float32Array(a.length)
  const block = w + 1
  // Máximo por blocos (rápido o bastante para alguns minutos de áudio).
  const blocks = Math.ceil(a.length / block)
  const bmax = new Float32Array(blocks)
  for (let i = 0; i < a.length; i++) bmax[Math.floor(i / block)] = Math.max(bmax[Math.floor(i / block)], a[i])
  for (let i = 0; i < a.length; i++) {
    const b0 = Math.max(0, Math.floor((i - w) / block))
    const b1 = Math.min(blocks - 1, Math.floor((i + w) / block))
    let m = 0
    for (let b = b0; b <= b1; b++) m = Math.max(m, bmax[b])
    out[i] = m
  }
  return out
}

const median = (a: ArrayLike<number>) => {
  const s = Array.from(a).sort((p, q) => p - q)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

export function detectOnsets(x: Float32Array, sr: number, opts: OnsetOptions = {}): Onset[] {
  const sensitivity = Math.min(100, Math.max(0, opts.sensitivity ?? SENSITIVITY_DEFAULT))
  const minGap = ((opts.minGapMs ?? MIN_GAP_MS) / 1000) * sr
  const { flux, rmsDb, center, N } = spectralFlux(x, sr)
  if (!flux.length) return []

  // Margem acima da mediana local: uma fração do maior pico por perto
  // (±1,5 s). Assim um ataque fraco logo depois de um forte não conta, mas
  // um trecho inteiro tocado mais baixo continua valendo.
  const ratio = 0.03 + 0.4 * (1 - sensitivity / 100)
  const W = 20 // ±100 ms para a mediana local
  const M = Math.round(1.5 / 0.005)
  const localMax = slidingMax(flux, M)
  let scale = 1e-9
  for (const v of flux) scale = Math.max(scale, v)

  const { env, step } = envelope(x, sr)
  const found: Onset[] = []
  let lastSample = -Infinity
  for (let f = 1; f < flux.length - 1; f++) {
    const v = flux[f]
    if (v <= 0) continue
    // Máximo local (±3 pedaços, ~15 ms).
    let isMax = true
    for (let k = Math.max(0, f - 3); k <= Math.min(flux.length - 1, f + 3); k++) {
      if (flux[k] > v || (flux[k] === v && k < f)) {
        isMax = false
        break
      }
    }
    if (!isMax) continue
    const local = median(flux.subarray(Math.max(0, f - W), Math.min(flux.length, f + W + 1)))
    if (v < local + ratio * localMax[f]) continue
    // Precisa ter volume de verdade logo depois do ataque.
    const loud = Math.max(rmsDb[f], rmsDb[Math.min(rmsDb.length - 1, f + 2)])
    if (loud < GATE_DB) continue

    const t = refine(env, step, center(f), N, sr)
    const strength = v / scale
    if (opts.ignore?.(t / sr, strength)) {
      found.push({ time: t / sr, strength, ignored: true })
      continue
    }
    if (t - lastSample < minGap) continue
    lastSample = t
    found.push({ time: t / sr, strength })
  }
  return found
}

// Instante (em amostras) em que o volume começa a subir, perto do pico do fluxo.
function refine(env: Float32Array, step: number, centerSample: number, N: number, sr: number) {
  const lo = Math.max(1, Math.floor((centerSample - N * 0.75) / step))
  const hi = Math.min(env.length - 1, Math.ceil((centerSample + N * 0.5) / step))
  if (hi <= lo) return centerSample
  // Ponto de subida mais forte do volume (comparando com 2 ms antes).
  const back = Math.max(1, Math.round((0.002 * sr) / step))
  let best = lo
  let bestRise = -Infinity
  for (let i = lo; i <= hi; i++) {
    const rise = env[i] - env[Math.max(0, i - back)]
    if (rise > bestRise) {
      bestRise = rise
      best = i
    }
  }
  // Pico logo depois dessa subida, e nível de antes.
  let peak = best
  const peakEnd = Math.min(env.length - 1, best + Math.round((0.01 * sr) / step))
  for (let i = best; i <= peakEnd; i++) if (env[i] > env[peak]) peak = i
  const preStart = Math.max(0, best - Math.round((0.02 * sr) / step))
  let pre = Infinity
  for (let i = preStart; i <= best; i++) pre = Math.min(pre, env[i])
  const level = pre + 0.2 * (env[peak] - pre)
  // Volta a partir do pico até o volume ficar abaixo de 20% da subida.
  let i = peak
  while (i > preStart && env[i - 1] > level) i--
  return i * step
}

// ---------------------------------------------------------------------------
// O ataque é o clique do metrônomo vazando no microfone?
// O clique é uma onda triangular de 1100 Hz (ou 1760 Hz no 1º tempo): quase
// toda a energia fica nessas frequências (e nos harmônicos ímpares). Uma
// nota de violão espalha energia por muitas frequências.
// ---------------------------------------------------------------------------
export const CLICK_FREQS = [1100, 1760]

/** 0 a 1: quanto do som logo após `time` (s) está nas frequências do clique. */
export function clickLikeness(x: Float32Array, sr: number, time: number) {
  // ~20 ms: o clique inteiro cabe, e uma nota que vem logo depois quase não entra.
  const N = sr > 32000 ? 1024 : 512
  const start = Math.max(0, Math.round(time * sr) - Math.round(sr * 0.001))
  if (start + N > x.length) return 0
  const win = hann(N)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let i = 0; i < N; i++) re[i] = x[start + i] * win[i]
  fft(re, im)
  const kLo = Math.floor((80 * N) / sr)
  const kHi = Math.ceil((8000 * N) / sr)
  const targets = CLICK_FREQS.flatMap((f) => [f, 3 * f])
  let total = 0
  let click = 0
  for (let k = kLo; k < kHi; k++) {
    const p = re[k] * re[k] + im[k] * im[k]
    total += p
    const hz = (k * sr) / N
    if (targets.some((f) => Math.abs(hz - f) <= Math.max(40, f * 0.03))) click += p
  }
  return total > 0 ? click / total : 0
}

/**
 * Tira do som as frequências do clique (1100 e 1760 Hz e seus harmônicos
 * 3x e 5x) com filtros "notch" bem estreitos. O violão perde muito pouco,
 * e o clique que vazou no microfone quase some antes da detecção.
 */
export function removeClickTones(x: Float32Array, sr: number) {
  let y: Float32Array = x
  for (const base of CLICK_FREQS)
    for (const h of [1, 3, 5]) {
      const f = base * h
      if (f < sr / 2 - 500) y = notch(y, sr, f, 6)
    }
  return y
}

// Filtro notch (receita clássica "RBJ biquad").
function notch(x: Float32Array, sr: number, f: number, q: number) {
  const w = (2 * Math.PI * f) / sr
  const alpha = Math.sin(w) / (2 * q)
  const cos = Math.cos(w)
  const a0 = 1 + alpha
  const b0 = 1 / a0
  const b1 = (-2 * cos) / a0
  const b2 = 1 / a0
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  const y = new Float32Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x[i]
    y2 = y1
    y1 = v
    y[i] = v
  }
  return y
}
