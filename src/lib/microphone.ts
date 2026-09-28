import { createDenoiser, setNoiseLevel, type NoiseLevel } from './denoise'
import { Recorder } from './recorder'

// ---------------------------------------------------------------------------
// Microfone + gravação, compartilhado pela aba Aprendizado (gráfico de
// amplitude) e pelo Musik player (ouvir a música para descobrir os acordes
// e gravar você tocando junto). Liga o microfone sem os "tratamentos" do
// navegador (eles estragam o som de instrumento), passa pela redução de
// ruído do app, se houver, e já começa a gravar.
// ---------------------------------------------------------------------------

export interface MicSession {
  ctx: AudioContext
  stream: MediaStream
  /** Som do microfone (já com a redução de ruído, se disponível). */
  input: AudioNode
  denoiser: AudioWorkletNode | null
  /** Gravação (null se o navegador não permitir gravar). */
  recorder: Recorder | null
  /** Para o microfone; o que foi gravado continua no `recorder`. */
  close(): void
}

export async function openMicrophone(noise: NoiseLevel): Promise<MicSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  // Redução de ruído (se o navegador não suportar, segue sem ela).
  let input: AudioNode = source
  let denoiser: AudioWorkletNode | null = null
  try {
    denoiser = await createDenoiser(ctx)
    setNoiseLevel(denoiser, noise)
    source.connect(denoiser)
    input = denoiser
  } catch {
    denoiser = null
  }
  // Grava tudo enquanto o microfone está ligado.
  let recorder: Recorder | null = new Recorder()
  try {
    await recorder.attach(ctx, input)
  } catch {
    recorder = null // sem gravação neste navegador; o resto segue funcionando
  }
  return {
    ctx,
    stream,
    input,
    denoiser,
    recorder,
    close() {
      recorder?.detach()
      stream.getTracks().forEach((tr) => tr.stop())
      void ctx.close()
    },
  }
}

/** Mensagem amigável quando o microfone não liga. */
export function micErrorMessage(e: unknown) {
  const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
  return denied
    ? 'O navegador não liberou o microfone. Clique no cadeado ao lado do endereço do site e permita o microfone.'
    : 'Não encontrei um microfone neste aparelho.'
}

/** Nível do som agora (dBFS, de −60 a 0) a partir de um AnalyserNode. */
export function levelDb(analyser: AnalyserNode, buf = new Float32Array(analyser.fftSize)) {
  analyser.getFloatTimeDomainData(buf)
  let s = 0
  for (const v of buf) s += v * v
  return Math.max(-60, 20 * Math.log10(Math.max(Math.sqrt(s / buf.length), 1e-6)))
}
