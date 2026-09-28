/// <reference lib="webworker" />
import { Mp3Encoder } from '@breezystack/lamejs'

// ---------------------------------------------------------------------------
// Conversão para MP3 num "worker" (uma linha de execução separada), para a
// tela não travar enquanto converte gravações longas. Usa o lamejs (LGPL).
// Recebe o som em 16 bits e devolve os pedaços do arquivo MP3.
// ---------------------------------------------------------------------------

interface Job {
  pcm: Int16Array
  sampleRate: number
  kbps: number
}

const FRAME = 1152 // tamanho de bloco que o MP3 usa

self.onmessage = (e: MessageEvent<Job>) => {
  const { pcm, sampleRate, kbps } = e.data
  const enc = new Mp3Encoder(1, sampleRate, kbps)
  const parts: Uint8Array[] = []
  const step = FRAME * 64
  for (let i = 0; i < pcm.length; i += step) {
    const out = enc.encodeBuffer(pcm.subarray(i, i + step))
    if (out.length) parts.push(new Uint8Array(out))
    self.postMessage({ progress: Math.min(1, (i + step) / pcm.length) })
  }
  const end = enc.flush()
  if (end.length) parts.push(new Uint8Array(end))
  self.postMessage({ done: true, parts })
}
