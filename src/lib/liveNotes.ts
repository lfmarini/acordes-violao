import { Chord, Note } from 'tonal'
import { chordTonalName } from './chords'
import type { LiveResult } from './liveDetect'
import type { Frame } from './recognize'

// ---------------------------------------------------------------------------
// Notas (com a oitava) que o violão virtual acende a cada análise.
//
// Os picos do espectro sozinhos enganam: harmônicos, ressonância do corpo e
// ruído viram "notas" que ninguém tocou. Por isso usamos o que o quadro
// "Tocando agora" já decidiu (ele junta o som de ~0,7 s antes de afirmar):
//  - uma nota soando  → só essa nota (na oitava ouvida);
//  - um acorde        → só as notas que pertencem ao acorde;
//  - notas soltas     → só essas notas;
//  - silêncio         → nada.
// E ainda exigimos força (metade da nota mais forte), afinação (25 cents) e
// no máximo 6 notas ao mesmo tempo (o violão tem 6 cordas).
// ---------------------------------------------------------------------------

/** Força mínima, em fração da fundamental mais forte do quadro. */
const MIN_STRENGTH = 0.6
/** Distância máxima da nota exata (0,25 = 25 cents). */
const MAX_DETUNE = 0.25
/** Faixa do violão: um pouco abaixo de E2 até ~E6. */
const MIN_HZ = 75
const MAX_HZ = 1400
const MAX_NOTES = 6

const pcOf = (note: string) => Note.chroma(note) ?? -1

/** Classes de nota (0 = C) que o resultado do "Tocando agora" permite. */
export function allowedPcs(live: LiveResult): Set<number> {
  if (live.kind === 'note') return new Set([pcOf(Note.pitchClass(live.note))])
  if (live.kind === 'notes') return new Set(live.notes.map(pcOf))
  if (live.kind === 'chord') return new Set(Chord.get(chordTonalName(live.chord)).notes.map(pcOf))
  return new Set()
}

/** Menor nota do violão afinado (E2). */
const LOWEST_MIDI = 40
/** Intervalos (semitons) dos harmônicos 2×, 3×, 4× e 5× acima da nota. */
const HARMONICS = [12, 19, 24, 28]
/** Abaixo disto (fração da mais forte), a nota "não aparece" no quadro. */
const ABSENT = 0.15
/** Força mínima para contar como harmônico presente. */
const HARMONIC_MIN = 0.2
/** Uma nota acima de outra (2×, 3×, 4×, 5×) é harmônico se a de baixo tiver ao menos 80% da força dela. */
const HARMONIC_RATIO = 0.8

export function pickNotes(frame: Frame, live: LiveResult): number[] {
  const allowed = allowedPcs(live)
  if (!allowed.size) return []
  const strongest = Math.max(0, ...frame.fundamentals.map((n) => n.strength))
  // Força de cada nota (afinada) no quadro, sem filtro nenhum: serve para
  // procurar harmônicos e fundamentais que "sumiram".
  const heard = new Map<number, number>()
  for (const n of frame.fundamentals) {
    if (n.f < MIN_HZ / 2 || n.f > MAX_HZ * 2) continue
    const midi = 69 + 12 * Math.log2(n.f / 440)
    const near = Math.round(midi)
    if (Math.abs(midi - near) > MAX_DETUNE) continue
    heard.set(near, Math.max(heard.get(near) ?? 0, n.strength / (strongest || 1)))
  }
  const level = (m: number) => heard.get(m) ?? 0

  let chosen = [...heard.entries()].filter(([m, v]) => {
    const hz = 440 * Math.pow(2, (m - 69) / 12)
    return v >= MIN_STRENGTH && hz >= MIN_HZ && hz <= MAX_HZ && allowed.has(((m % 12) + 12) % 12)
  })

  // Fundamental que sumiu (microfone de celular quase não capta graves): se a
  // oitava de cima (2×) e a quinta acima dela (3×) soam, mas a nota de baixo
  // não aparece, quem tocou foi a nota de baixo; as outras são harmônicos.
  const drop = new Set<number>()
  const add = new Map<number, number>()
  for (const [c, v] of [...chosen].sort((a, b) => a[0] - b[0])) {
    const r = c - 12
    if (drop.has(c) || r < LOWEST_MIDI || level(r) >= ABSENT || level(r + 19) < HARMONIC_MIN) continue
    if (!allowed.has(((r % 12) + 12) % 12)) continue
    add.set(r, v)
    for (const h of HARMONICS) drop.add(r + h)
  }
  chosen = [...chosen.filter(([m]) => !drop.has(m)), ...add.entries()]

  // Harmônicos de menor intensidade: uma nota que fica 1 ou 2 oitavas, uma
  // oitava + quinta ou duas oitavas + terça (2×, 3×, 4×, 5× da frequência)
  // acima de outra nota escolhida, e soa mais fraca que ela, é harmônico dela.
  const force = new Map(chosen)
  chosen = chosen.filter(([m, v]) => !HARMONICS.some((h) => (force.get(m - h) ?? 0) >= v * HARMONIC_RATIO))

  // Uma nota só (ex.: "A3"): acende uma posição só, da mesma nota do quadro,
  // na oitava mais grave que sobrou (a de cima costuma ser harmônico).
  if (live.kind === 'note') {
    const pc = pcOf(Note.pitchClass(live.note))
    const same = chosen.map(([m]) => m).filter((m) => ((m % 12) + 12) % 12 === pc)
    return same.length ? [Math.min(...same)] : []
  }
  return chosen
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_NOTES)
    .map(([m]) => m)
    .sort((a, b) => a - b)
}
