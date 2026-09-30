// ---------------------------------------------------------------------------
// Redução de ruído do microfone, regulável de 0 a 100%.
//
// O navegador tem um "noise suppression" próprio, mas ele é feito para voz e
// costuma cortar o som sustentado do violão. Por isso fazemos o nosso:
//
// 1. O som é cortado em janelas curtas (21 ms) e passa pela FFT, que separa
//    cada janela em faixas de frequência.
// 2. Em cada faixa, estimamos o "chão" de ruído: o nível mais baixo que a
//    faixa atingiu recentemente (ventilador, chiado, zumbido de geladeira
//    ficam sempre lá; as notas vêm e vão). Esse chão sobe devagar, para
//    acompanhar mudanças no ambiente sem confundir nota longa com ruído.
// 3. Cada faixa é atenuada conforme o quanto ela está acima do ruído
//    (subtração espectral). Quanto mais forte o nível escolhido, mais ruído
//    sai — e mais risco de "comer" um pouco do som fraco do violão.
// 4. As janelas são remontadas (FFT inversa + sobreposição) e seguem para o
//    gráfico, a identificação de acordes e a gravação.
// ---------------------------------------------------------------------------

/**
 * Intensidade da redução de ruído, de 0 (desligada) a 100 (máxima).
 * Os nomes antigos ('off', 'fraca', 'media', 'forte') ainda são aceitos:
 * valem 0, 33, 66 e 100.
 */
export type NoiseLevel = number | 'off' | 'fraca' | 'media' | 'forte'

/** Valor inicial da barra: uma redução leve. */
export const NOISE_DEFAULT = 30

const LEGACY: Record<string, number> = { off: 0, fraca: 33, media: 66, forte: 100 }

/** Converte qualquer valor guardado (número ou nome antigo) para 0–100. */
export function noisePercent(level: unknown): number {
  if (typeof level === 'number' && Number.isFinite(level)) return Math.min(100, Math.max(0, Math.round(level)))
  if (typeof level === 'string' && level in LEGACY) return LEGACY[level]
  return NOISE_DEFAULT
}

export interface NoiseParams {
  alpha: number // quanto do ruído estimado é subtraído
  floor: number // quanto sobra, no mínimo, de cada faixa (evita som "aquático")
  gate: number // quando só há ruído na janela, ela é abaixada inteira por esse fator
}

// Pontos de referência da barra; entre eles os valores são interpolados.
// 33% e 66% equivalem aos antigos "fraca" e "média"; 100% ao antigo "forte".
const ANCHORS: [number, NoiseParams][] = [
  [0, { alpha: 0.8, floor: 0.55, gate: 1 }],
  [33, { alpha: 1.5, floor: 0.35, gate: 1 }],
  [66, { alpha: 3, floor: 0.16, gate: 1 }],
  [100, { alpha: 14, floor: 0.012, gate: 0.08 }],
]

/** Parâmetros do processador para a intensidade escolhida (null = desligada). */
export function noiseParams(level: NoiseLevel): NoiseParams | null {
  const pct = noisePercent(level)
  if (pct <= 0) return null
  const k = ANCHORS.findIndex(([p]) => p >= pct)
  const [p0, a] = ANCHORS[k - 1]
  const [p1, b] = ANCHORS[k]
  const t = (pct - p0) / (p1 - p0)
  const mix = (x: number, y: number) => x + (y - x) * t
  return { alpha: mix(a.alpha, b.alpha), floor: mix(a.floor, b.floor), gate: mix(a.gate, b.gate) }
}

// Código do processador. Fica numa string porque roda no "AudioWorklet",
// um ambiente separado do resto do app. Também é usado pelo teste em Node.
export const DENOISE_WORKLET = `
const N = 1024, H = 256, HALF = N / 2
const RISE = 1.0015 // quanto o chão de ruído sobe por janela (~+1,3 dB/s)
const BIAS = 3 // o mínimo fica abaixo da média do ruído; compensamos

class Denoiser extends AudioWorkletProcessor {
  constructor() {
    super()
    this.alpha = 0; this.floor = 1; this.gate = 1; this.gateGain = 1; this.on = false
    this.win = new Float32Array(N)
    for (let i = 0; i < N; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
    this.inBuf = new Float32Array(N); this.fresh = new Float32Array(H); this.fill = 0
    this.acc = new Float32Array(N)
    this.queue = new Float32Array(N * 4); this.qr = 0; this.qw = 0; this.qn = 0
    this.re = new Float32Array(N); this.im = new Float32Array(N)
    this.pow = new Float32Array(HALF + 1); this.noise = new Float32Array(HALF + 1); this.gain = new Float32Array(HALF + 1).fill(1)
    this.frames = 0
    // Tabelas da FFT
    this.rev = new Uint32Array(N)
    for (let i = 0, j = 0; i < N; i++) { this.rev[i] = j; let bit = N >> 1; while (j & bit) { j ^= bit; bit >>= 1 } j |= bit }
    this.cos = new Float32Array(HALF); this.sin = new Float32Array(HALF)
    for (let k = 0; k < HALF; k++) { this.cos[k] = Math.cos((2 * Math.PI * k) / N); this.sin[k] = -Math.sin((2 * Math.PI * k) / N) }
    this.port.onmessage = (e) => this.setLevel(e.data)
  }

  setLevel(p) {
    this.on = !!p && p.alpha > 0
    if (this.on) { this.alpha = p.alpha; this.floor = p.floor; this.gate = p.gate }
  }

  fft(re, im, inverse) {
    const rev = this.rev
    for (let i = 0; i < N; i++) { const j = rev[i]; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t } }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size
      for (let i = 0; i < N; i += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step], wi = inverse ? -this.sin[k * step] : this.sin[k * step]
          const a = i + k, b = a + half
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
        }
      }
    }
  }

  frame() {
    const { re, im, win } = this
    for (let i = 0; i < N; i++) { re[i] = this.inBuf[i] * win[i]; im[i] = 0 }
    this.fft(re, im, false)
    const first = this.frames++ < 8
    let sumP = 0, sumN = 0
    for (let k = 0; k <= HALF; k++) {
      const p = re[k] * re[k] + im[k] * im[k]
      this.pow[k] = first ? p : 0.8 * this.pow[k] + 0.2 * p
      // Chão de ruído: segue o mínimo e sobe devagar.
      if (first) this.noise[k] = this.pow[k]
      else if (this.pow[k] < this.noise[k]) this.noise[k] = this.pow[k]
      else this.noise[k] = this.noise[k] * RISE + 1e-12
      sumP += p; sumN += BIAS * this.noise[k]
      let g = 1
      if (this.on) g = Math.max(this.floor, 1 - (this.alpha * BIAS * this.noise[k]) / Math.max(p, 1e-12))
      // Sobe rápido (não corta o ataque da nota) e desce devagar (menos "chiado metálico").
      this.gain[k] = g > this.gain[k] ? g : 0.65 * this.gain[k] + 0.35 * g
      const gk = this.gain[k]
      re[k] *= gk; im[k] *= gk
    }
    // Portão: janela só com ruído (energia perto do chão) é abaixada inteira.
    const target = this.on && sumP < sumN * 2.5 ? this.gate : 1
    this.gateGain = target < this.gateGain ? 0.85 * this.gateGain + 0.15 * target : 0.4 * this.gateGain + 0.6 * target
    for (let k = 0; k <= HALF; k++) {
      re[k] *= this.gateGain; im[k] *= this.gateGain
      if (k > 0 && k < HALF) { re[N - k] = re[k]; im[N - k] = -im[k] }
    }
    this.fft(re, im, true)
    // Janela de síntese; com 75% de sobreposição a soma das janelas dá 2.
    for (let i = 0; i < N; i++) this.acc[i] += (re[i] / N) * win[i] * 0.5
    for (let i = 0; i < H; i++) { this.queue[this.qw] = this.acc[i]; this.qw = (this.qw + 1) % this.queue.length; this.qn++ }
    this.acc.copyWithin(0, H); this.acc.fill(0, N - H)
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0]
    const out = outputs[0] && outputs[0][0]
    if (!out) return true
    for (let i = 0; i < out.length; i++) {
      this.fresh[this.fill++] = input ? input[i] : 0
      if (this.fill === H) {
        this.inBuf.copyWithin(0, H); this.inBuf.set(this.fresh, N - H); this.fill = 0
        this.frame()
      }
      if (this.qn > 0) { out[i] = this.queue[this.qr]; this.qr = (this.qr + 1) % this.queue.length; this.qn-- }
      else out[i] = 0
    }
    return true
  }
}
registerProcessor('denoiser', Denoiser)
`

export async function createDenoiser(ctx: AudioContext) {
  const url = URL.createObjectURL(new Blob([DENOISE_WORKLET], { type: 'application/javascript' }))
  try {
    await ctx.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  return new AudioWorkletNode(ctx, 'denoiser', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
}

export function setNoiseLevel(node: AudioWorkletNode, level: NoiseLevel) {
  node.port.postMessage(noiseParams(level))
}
