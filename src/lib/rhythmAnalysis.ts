import { clickLikeness, detectOnsets, removeClickTones } from './onsets'
import type { Tick } from './rhythmClock'
import { matchOnsets, type GridPoint, type Matching } from './rhythmStats'

// ---------------------------------------------------------------------------
// Junta a gravação e os tiques do metrônomo numa linha do tempo só e mede
// cada ataque. Tudo em segundos desde o início da gravação.
//
// Latência: o clique agendado para o instante T sai no fone um pouco depois
// (latência de saída) e o som do violão chega à gravação um pouco depois de
// tocado (latência de entrada). Um ataque tocado exatamente junto com o
// clique aparece na gravação em T + saída + entrada. Por isso a grade é
// deslocada pela soma das duas (mais o ajuste manual/calibração).
// ---------------------------------------------------------------------------

export interface Take {
  samples: Float32Array
  sampleRate: number
  /** Horário (relógio do áudio, s) da 1ª amostra. */
  startCtx: number
  ticks: Tick[]
}

export interface AnalysisOptions {
  /** Latência total a compensar (s): automática + ajuste. */
  latency: number
  sensitivity: number
  minGapMs?: number
  /** Contratempo: o alvo é o meio de cada divisão (o "e"), não o clique. */
  offbeat?: boolean
  /** Ignorar ataques que coincidem com o clique e têm o timbre dele. */
  rejectClicks?: boolean
}

export interface DetectedOnset {
  time: number
  strength: number
  /** Parece o clique do metrônomo vazando no microfone (ignorado). */
  click: boolean
}

export interface TakeAnalysis {
  onsets: DetectedOnset[]
  grid: GridPoint[]
  /** Onde os cliques chegam na gravação (s), para desenhar. */
  clicks: { time: number; accent: boolean }[]
  matching: Matching
  duration: number
}

/** Um ataque forte depois do filtro é violão, mesmo perto do clique. */
const CLICK_MAX_STRENGTH = 0.5
/** Distância máxima (s) entre um ataque e a chegada do clique para ser suspeito de ser o clique. */
const CLICK_WINDOW = 0.03
/** A partir de quanto da energia nas frequências do clique o ataque é considerado clique. */
const CLICK_RATIO = 0.6

export function analyzeTake(take: Take, o: AnalysisOptions): TakeAnalysis {
  const { samples, sampleRate: sr, startCtx } = take
  const duration = samples.length / sr
  const at = (t: Tick) => t.time - startCtx + o.latency
  const inside = (s: number) => s >= 0 && s <= duration

  const clicks = take.ticks.filter((t) => t.clicked && inside(at(t))).map((t) => ({ time: at(t), accent: t.sub === 0 && t.beat === 0 }))
  const grid: GridPoint[] = take.ticks
    .filter((t) => t.note >= 0)
    .map((t) => ({ time: at(t) + (o.offbeat ? t.dur / 2 : 0), muted: t.muted, main: t.sub === 0, bar: t.sub === 0 && t.beat === 0 }))
    .filter((g) => inside(g.time))

  // Com o clique vazando no microfone: primeiro tiramos as frequências dele.
  const filtered = o.rejectClicks ? removeClickTones(samples, sr) : samples
  const ignore = (t: number, strength: number) => {
    if (!o.rejectClicks || !clicks.some((c) => Math.abs(c.time - t) <= CLICK_WINDOW)) return false
    return strength < CLICK_MAX_STRENGTH && clickLikeness(samples, sr, t) >= CLICK_RATIO
  }
  const raw = detectOnsets(filtered, sr, { sensitivity: o.sensitivity, minGapMs: o.minGapMs, ignore })
  const onsets: DetectedOnset[] = raw.map((r) => ({ time: r.time, strength: r.strength, click: !!r.ignored }))
  const matching = matchOnsets(
    onsets.filter((x) => !x.click).map((x) => x.time),
    grid,
  )
  return { onsets, grid, clicks, matching, duration }
}
