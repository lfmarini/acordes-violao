// ---------------------------------------------------------------------------
// Gravação do microfone para salvar como arquivo .wav.
//
// Um "AudioWorklet" (pedacinho de código que roda junto do áudio) recebe as
// amostras do microfone e as manda para cá em blocos. Guardamos tudo em
// 16 bits (a qualidade de CD), que ocupa metade da memória. Na hora de
// salvar, montamos o arquivo WAV com o trecho pedido (últimos 10 s, 30 s,
// 1 min ou tudo) e o navegador baixa o arquivo. Nada sai do aparelho.
// ---------------------------------------------------------------------------

/** Limite da gravação guardada na memória, em minutos (depois disso, descarta o começo). */
export const MAX_RECORD_MIN = 20

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

export class Recorder {
  private chunks: Int16Array[] = []
  private length = 0
  sampleRate = 48000
  private node: AudioWorkletNode | null = null

  /** Segundos gravados até agora. */
  get seconds() {
    return this.length / this.sampleRate
  }

  async attach(ctx: AudioContext, source: AudioNode) {
    this.chunks = []
    this.length = 0
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

  /** Monta um arquivo WAV com os últimos `seconds` segundos (ou tudo, se omitido). */
  toWav(seconds?: number): Blob {
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
