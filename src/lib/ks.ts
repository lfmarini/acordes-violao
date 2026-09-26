// ---------------------------------------------------------------------------
// Síntese de corda de violão (Karplus-Strong estendido, Jaffe & Smith 1983).
//
// Ideia: uma corda de verdade é uma onda que vai e volta entre o cavalete e a
// pestana. Simulamos isso com uma "fila" de amostras de tamanho = 1 período da
// nota. Enchemos a fila com um ruído (o golpe da palheta/dedo) e, a cada volta,
// a onda passa por um filtro que perde um pouco dos agudos — exatamente como a
// corda real, que fica mais "redonda" enquanto soa.
//
// Detalhes que fazem soar como violão (e não como o PluckSynth genérico):
// - afinação exata: um filtro "passa-tudo" corrige a fração de amostra que
//   sobra no período (sem isso as notas agudas saem desafinadas);
// - posição do ataque: tocar perto do cavalete tira alguns harmônicos;
// - dedo x palheta: um filtro suaviza o ruído inicial (som de dedo);
// - cordas graves soam mais tempo que as agudas.
//
// Esta função não depende do navegador: gera um Float32Array com o som.
// ---------------------------------------------------------------------------

export interface PluckOptions {
  /** Frequência da nota em Hz (ex.: 82.41 para a 6ª corda solta, E2). */
  freq: number
  sampleRate: number
  /** Duração do som gerado, em segundos. */
  duration: number
  /** Tempo (s) para a corda cair 60 dB. Graves ~4 s, agudas ~2,5 s. */
  t60?: number
  /** Posição do ataque ao longo da corda (0 = cavalete). 0,13 ≈ boca do violão. */
  pickPosition?: number
  /** 0 = ataque bem macio (dedo), 1 = brilhante (palheta). */
  brightness?: number
  /** Semente do ruído, para cada corda soar levemente diferente. */
  seed?: number
}

export function synthPluck({
  freq,
  sampleRate,
  duration,
  t60 = 3,
  pickPosition = 0.13,
  brightness = 0.45,
  seed = 1,
}: PluckOptions): Float32Array {
  const total = Math.floor(duration * sampleRate)
  const out = new Float32Array(total)

  // Período em amostras. O filtro de média (2 pontos) atrasa 0,5 amostra;
  // o resto fracionário fica com o filtro passa-tudo.
  const period = sampleRate / freq
  let L = Math.floor(period - 0.5)
  let frac = period - 0.5 - L
  if (frac < 0.1) {
    L -= 1
    frac += 1
  }
  const apC = (1 - frac) / (1 + frac)

  // Perda por volta para a corda cair 60 dB em t60 segundos.
  const loss = Math.pow(0.001, 1 / (freq * t60))

  // Excitação: ruído (golpe) suavizado e com o "pente" da posição do ataque.
  let rnd = seed * 9301 + 49297
  const noise = () => {
    rnd = (rnd * 9301 + 49297) % 233280
    return rnd / 233280 - 0.5
  }
  const raw = new Float32Array(L)
  const smooth = 1 - Math.min(Math.max(brightness, 0.02), 1)
  let lp = 0
  for (let i = 0; i < L; i++) {
    lp = (1 - smooth) * noise() + smooth * lp
    raw[i] = lp
  }
  const offset = Math.max(1, Math.round(pickPosition * L))
  const line = new Float32Array(L)
  let mean = 0
  for (let i = 0; i < L; i++) {
    line[i] = raw[i] - (i >= offset ? raw[i - offset] : 0)
    mean += line[i]
  }
  // Tira o "deslocamento" (DC) para o som não estalar, e normaliza.
  mean /= L
  let peak = 1e-9
  for (let i = 0; i < L; i++) {
    line[i] -= mean
    peak = Math.max(peak, Math.abs(line[i]))
  }
  for (let i = 0; i < L; i++) line[i] *= 0.8 / peak

  // Laço da corda.
  let ptr = 0
  let prev = 0
  let apIn = 0
  let apOut = 0
  for (let n = 0; n < total; n++) {
    const y = line[ptr]
    out[n] = y
    const avg = loss * 0.5 * (y + prev) // perde agudos a cada volta
    prev = y
    const ap = apC * avg + apIn - apC * apOut // corrige a afinação
    apIn = avg
    apOut = ap
    line[ptr] = ap
    ptr = ptr + 1 === L ? 0 : ptr + 1
  }

  // Micro fade-in para evitar clique no início.
  const fade = Math.min(32, total)
  for (let i = 0; i < fade; i++) out[i] *= i / fade
  return out
}
