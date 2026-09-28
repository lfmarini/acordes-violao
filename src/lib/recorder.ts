// ---------------------------------------------------------------------------
// Gravação do microfone para salvar como arquivo .wav.
//
// Um "AudioWorklet" (pedacinho de código que roda junto do áudio) recebe as
// amostras do microfone e as manda para cá em blocos. Guardamos tudo em
// 16 bits (a qualidade de CD), que ocupa metade da memória. Na hora de
// salvar, montamos o arquivo WAV com o trecho pedido (últimos 10 s, 30 s,
// 1 min ou tudo) em MP3 (pequeno) ou WAV (sem perda) e o navegador baixa
// o arquivo. Nada sai do aparelho.
// ---------------------------------------------------------------------------

/** Limite da gravação guardada na memória, em minutos (depois disso, descarta o começo). */
export const MAX_RECORD_MIN = 20
/** Qualidade do MP3 (kbps). 128 é qualidade de rádio/streaming, ótima para estudo. */
export const MP3_KBPS = 128

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i]
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0 }
    }
    return true
  }
}
registerProcessor('capture', Capture)
`

/** Batida do metrônomo: horário (performance.now) e se é o 1º tempo. */
export interface Click {
  at: number
  accent: boolean
}
/** Volume do metrônomo misturado na gravação (0 a 1). */
const CLICK_LEVEL = 0.35

export class Recorder {
  private chunks: Int16Array[] = []
  private length = 0 // amostras guardadas agora
  private total = 0 // amostras recebidas desde o início (inclui as descartadas)
  private startPerf = 0 // horário (performance.now) da primeira amostra
  sampleRate = 48000
  private node: AudioWorkletNode | null = null

  /** Horário (performance.now) da 1ª amostra ainda guardada: o início do replay. */
  get startTime() {
    return this.startPerf + ((this.total - this.length) / this.sampleRate) * 1000
  }

  /** Segundos gravados até agora. */
  get seconds() {
    return this.length / this.sampleRate
  }

  async attach(ctx: AudioContext, source: AudioNode) {
    this.chunks = []
    this.length = 0
    this.total = 0
    this.startPerf = 0
    this.sampleRate = ctx.sampleRate
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    try {
      await ctx.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    const node = new AudioWorkletNode(ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 1 })
    node.port.onmessage = (e: MessageEvent<Float32Array>) => this.push(e.data)
    // Ligado a uma saída muda: alguns navegadores só processam o que chega na saída.
    const mute = ctx.createGain()
    mute.gain.value = 0
    source.connect(node).connect(mute).connect(ctx.destination)
    this.node = node
  }

  detach() {
    if (this.node) this.node.port.onmessage = null
    this.node?.disconnect()
    this.node = null
  }

  private push(block: Float32Array) {
    // A primeira amostra do bloco soou há "tamanho do bloco" segundos.
    if (this.total === 0) this.startPerf = performance.now() - (block.length / this.sampleRate) * 1000
    this.total += block.length
    const pcm = new Int16Array(block.length)
    for (let i = 0; i < block.length; i++) {
      const v = Math.max(-1, Math.min(1, block[i]))
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff
    }
    this.chunks.push(pcm)
    this.length += pcm.length
    const max = MAX_RECORD_MIN * 60 * this.sampleRate
    while (this.length - this.chunks[0].length > max) this.length -= this.chunks.shift()!.length
  }

  /** Os últimos `seconds` segundos gravados (ou tudo, se omitido), em 16 bits. */
  // Com `clicks`, mistura o som do metrônomo nos instantes das batidas.
  slice(seconds?: number, clicks?: Click[]): Int16Array<ArrayBuffer> {
    const want = seconds ? Math.min(this.length, Math.round(seconds * this.sampleRate)) : this.length
    const data = new Int16Array(want)
    // Copia do fim para o começo, para pegar só o trecho final.
    let pos = want
    for (let i = this.chunks.length - 1; i >= 0 && pos > 0; i--) {
      const c = this.chunks[i]
      const take = Math.min(c.length, pos)
      data.set(c.subarray(c.length - take), pos - take)
      pos -= take
    }
    if (clicks?.length) this.mixClicks(data, clicks)
    return data
  }

  // Soma o "tic" do metrônomo em cada batida que cai dentro do trecho.
  private mixClicks(data: Int16Array, clicks: Click[]) {
    const sr = this.sampleRate
    const firstAbs = this.total - data.length // índice absoluto da 1ª amostra do trecho
    const tone = (accent: boolean) => {
      const n = Math.round(0.06 * sr)
      const f = accent ? 1760 : 1100
      const a = (accent ? 1 : 0.6) * CLICK_LEVEL
      // Onda triangular com ataque de 2 ms e queda exponencial, igual ao metrônomo.
      return Float32Array.from({ length: n }, (_, i) => {
        const t = i / sr
        const tri = (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * f * t))
        const env = t < 0.002 ? t / 0.002 : Math.exp(-(t - 0.002) / 0.012)
        return tri * env * a
      })
    }
    const sounds = { true: tone(true), false: tone(false) }
    for (const c of clicks) {
      const at = Math.round(((c.at - this.startPerf) / 1000) * sr) - firstAbs
      const wave = sounds[String(c.accent) as 'true' | 'false']
      if (at + wave.length < 0 || at >= data.length) continue
      for (let i = Math.max(0, -at); i < wave.length && at + i < data.length; i++) {
        const v = data[at + i] + wave[i] * 0x7fff
        data[at + i] = Math.max(-0x8000, Math.min(0x7fff, v))
      }
    }
  }

  /**
   * Arquivo MP3 com os últimos `seconds` segundos. Bem menor que o WAV
   * (128 kbps ≈ 1 MB por minuto) e abre em qualquer celular ou computador.
   * A conversão roda num worker; `onProgress` recebe de 0 a 1.
   */
  toMp3(seconds: number | undefined, clicks?: Click[], onProgress?: (p: number) => void): Promise<Blob> {
    const pcm = this.slice(seconds, clicks)
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<{ progress?: number; done?: boolean; parts?: Uint8Array[] }>) => {
        if (e.data.progress !== undefined) onProgress?.(e.data.progress)
        if (e.data.done) {
          worker.terminate()
          resolve(new Blob(e.data.parts as BlobPart[], { type: 'audio/mpeg' }))
        }
      }
      worker.onerror = (err) => {
        worker.terminate()
        reject(err)
      }
      worker.postMessage({ pcm, sampleRate: this.sampleRate, kbps: MP3_KBPS }, [pcm.buffer])
    })
  }

  /** Arquivo WAV (sem perda de qualidade, mas ~6x maior que o MP3). */
  toWav(seconds?: number, clicks?: Click[]): Blob {
    const data = this.slice(seconds, clicks)
    // Cabeçalho WAV (PCM, mono, 16 bits).
    const header = new DataView(new ArrayBuffer(44))
    const text = (o: number, s: string) => [...s].forEach((ch, i) => header.setUint8(o + i, ch.charCodeAt(0)))
    text(0, 'RIFF')
    header.setUint32(4, 36 + data.byteLength, true)
    text(8, 'WAVE')
    text(12, 'fmt ')
    header.setUint32(16, 16, true)
    header.setUint16(20, 1, true) // PCM
    header.setUint16(22, 1, true) // mono
    header.setUint32(24, this.sampleRate, true)
    header.setUint32(28, this.sampleRate * 2, true)
    header.setUint16(32, 2, true)
    header.setUint16(34, 16, true)
    text(36, 'data')
    header.setUint32(40, data.byteLength, true)
    return new Blob([header, data], { type: 'audio/wav' })
  }
}

/** Nome do arquivo de gravação: prefixo, data e hora, e um detalhe (ex.: "30s", "inteira"). */
export function recordingFileName(prefix: string, detail: string, ext: 'mp3' | 'wav') {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}`
  const safe = prefix
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return `${safe}_${stamp}_${detail}.${ext}`
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
