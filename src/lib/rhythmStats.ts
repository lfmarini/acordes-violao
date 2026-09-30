// ---------------------------------------------------------------------------
// Cálculo do d3lay do treino de ritmo.
//
// Para cada ataque, o d3lay é a diferença até o ponto MAIS PRÓXIMO da grade
// (beat ou subdivisão): sempre o menor valor em módulo. Assim um ataque
// atrasado nunca conta como adiantado em relação ao beat seguinte.
// Sinal: negativo = adiantado, positivo = atrasado.
//
// - Pontos da grade sem nenhum ataque: descartados das contas, mas contados
//   ("beats sem ataque").
// - Dois ou mais ataques no mesmo ponto: vale o mais próximo; os outros
//   viram "ataques extras" (aviso) e não entram nas contas.
// ---------------------------------------------------------------------------

export interface GridPoint {
  /** Segundos, na mesma linha do tempo dos ataques. */
  time: number
  /** Compasso silenciado (metrônomo esparso). */
  muted?: boolean
  /** No tempo (não é divisão). */
  main?: boolean
  /** 1º tempo do compasso. */
  bar?: boolean
}

export interface Hit {
  /** Horário do ataque (s). */
  time: number
  /** d3lay em ms (negativo = adiantado). */
  delay: number
  /** Índice do ponto da grade. */
  grid: number
  /** Ponto da grade num compasso sem clique. */
  muted: boolean
}

export interface Matching {
  hits: Hit[]
  extras: Hit[]
  /** Pontos da grade sem nenhum ataque. */
  missed: number
  /** Ataques fora da grade (antes do 1º ponto ou depois do último). */
  outside: number
}

/** Índice do ponto da grade mais próximo de `t` (a grade está em ordem). */
export function nearest(grid: GridPoint[], t: number) {
  let lo = 0
  let hi = grid.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (grid[mid].time <= t) lo = mid
    else hi = mid
  }
  return Math.abs(grid[hi].time - t) < Math.abs(grid[lo].time - t) ? hi : lo
}

export function matchOnsets(onsets: number[], grid: GridPoint[]): Matching {
  const out: Matching = { hits: [], extras: [], missed: 0, outside: 0 }
  if (!grid.length) return { ...out, outside: onsets.length }
  // Metade do intervalo nas pontas: ataques mais longe que isso ficam de fora.
  const firstGap = grid.length > 1 ? grid[1].time - grid[0].time : 0.5
  const lastGap = grid.length > 1 ? grid[grid.length - 1].time - grid[grid.length - 2].time : 0.5
  const start = grid[0].time - firstGap / 2
  const end = grid[grid.length - 1].time + lastGap / 2

  const byGrid = new Map<number, Hit[]>()
  for (const t of onsets) {
    if (t < start || t > end) {
      out.outside++
      continue
    }
    const g = nearest(grid, t)
    const hit: Hit = { time: t, delay: (t - grid[g].time) * 1000, grid: g, muted: !!grid[g].muted }
    byGrid.set(g, [...(byGrid.get(g) ?? []), hit])
  }
  for (let g = 0; g < grid.length; g++) {
    const list = byGrid.get(g)
    if (!list) {
      out.missed++
      continue
    }
    list.sort((a, b) => Math.abs(a.delay) - Math.abs(b.delay))
    out.hits.push(list[0])
    out.extras.push(...list.slice(1))
  }
  return out
}

export interface DelayStats {
  n: number
  /** % de ataques com |d3lay| <= x. */
  hitPct: number
  /** Média de |d3lay| (ms). */
  meanAbs: number
  /** Mediana de |d3lay| (ms). */
  medianAbs: number
  /** Desvio padrão do d3lay com sinal (ms). */
  sd: number
  /** Média com sinal (ms): negativa = tende a adiantar; positiva = a atrasar. */
  meanSigned: number
}

export function delayStats(delays: number[], tolerance: number): DelayStats {
  const n = delays.length
  if (!n) return { n: 0, hitPct: 0, meanAbs: 0, medianAbs: 0, sd: 0, meanSigned: 0 }
  const abs = delays.map(Math.abs).sort((a, b) => a - b)
  const meanSigned = delays.reduce((s, d) => s + d, 0) / n
  const variance = delays.reduce((s, d) => s + (d - meanSigned) ** 2, 0) / n
  const medianAbs = n % 2 ? abs[(n - 1) / 2] : (abs[n / 2 - 1] + abs[n / 2]) / 2
  return {
    n,
    hitPct: (100 * abs.filter((d) => d <= tolerance).length) / n,
    meanAbs: abs.reduce((s, d) => s + d, 0) / n,
    medianAbs,
    sd: Math.sqrt(variance),
    meanSigned,
  }
}

/** Contagem por faixas de `width` ms (com sinal), de −limit a +limit. */
export function histogram(delays: number[], width = 5, limit?: number) {
  const max = limit ?? Math.max(width * 4, Math.ceil(Math.max(0, ...delays.map(Math.abs)) / width) * width)
  const bins: { from: number; to: number; count: number }[] = []
  for (let a = -max; a < max; a += width) bins.push({ from: a, to: a + width, count: 0 })
  for (const d of delays) {
    const i = Math.min(bins.length - 1, Math.max(0, Math.floor((d + max) / width)))
    bins[i].count++
  }
  return bins
}
