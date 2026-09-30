import { readStored, writeStored } from './storage'

// ---------------------------------------------------------------------------
// Histórico do treino de ritmo, guardado só neste aparelho (localStorage).
// Cada gravação analisada vira uma sessão.
// ---------------------------------------------------------------------------

export interface RhythmSession {
  id: string
  /** Data e hora (ISO). */
  date: string
  exerciseId: string
  exerciseName: string
  bpm: number
  /** Notas por tempo (0 = modo escada). */
  nps: number
  /** Tolerância x (ms). */
  tolerance: number
  hitPct: number
  meanAbs: number
  medianAbs: number
  meanSigned: number
  /** Ataques medidos. */
  n: number
  /** Observações curtas (ex.: "contratempo", "esparso"). */
  tags?: string[]
}

const KEY = 'ritmo-historico'
const MAX = 1000

export const loadSessions = (): RhythmSession[] => readStored<RhythmSession[]>(KEY, [])

/** Acrescenta ou atualiza (mesmo id) uma sessão; devolve a lista nova. */
export function saveSession(s: RhythmSession): RhythmSession[] {
  const list = loadSessions().filter((x) => x.id !== s.id)
  list.push(s)
  list.sort((a, b) => a.date.localeCompare(b.date))
  const trimmed = list.slice(-MAX)
  writeStored(KEY, trimmed)
  return trimmed
}

export function deleteSession(id: string): RhythmSession[] {
  const list = loadSessions().filter((x) => x.id !== id)
  writeStored(KEY, list)
  return list
}

/** Dia (AAAA-MM-DD) no fuso do aparelho. */
export function dayKey(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Média da % de acerto por dia, de um exercício, em ordem de data. */
export function dailyProgress(sessions: RhythmSession[], exerciseId: string) {
  const days = new Map<string, { sum: number; count: number; bpmMax: number }>()
  for (const s of sessions) {
    if (s.exerciseId !== exerciseId) continue
    const k = dayKey(s.date)
    const d = days.get(k) ?? { sum: 0, count: 0, bpmMax: 0 }
    d.sum += s.hitPct
    d.count++
    d.bpmMax = Math.max(d.bpmMax, s.bpm)
    days.set(k, d)
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, d]) => ({ day, hitPct: d.sum / d.count, sessions: d.count, bpmMax: d.bpmMax }))
}
