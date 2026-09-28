import { Note } from 'tonal'
import { QUALITIES, type ChordRef } from '../lib/chords'
import { keyInfo, type Mode } from '../lib/harmony'

// ---------------------------------------------------------------------------
// Círculo de quintas. Andando no sentido horário, cada tom está uma quinta
// acima do anterior (C → G → D...) e ganha um sustenido; no anti-horário,
// uma quarta acima (C → F → Bb...) e ganha um bemol. Por fora ficam os tons
// maiores; por dentro, os relativos menores (mesma armadura).
// Os vizinhos do tom escolhido formam o campo harmônico: IV à esquerda,
// V à direita, e os menores ii, vi e iii logo abaixo.
// ---------------------------------------------------------------------------

const MAJORS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F']
const MINORS = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'Eb', 'Bb', 'F', 'C', 'G', 'D']
const MAJOR_LABEL = ['C', 'G', 'D', 'A', 'E', 'B', 'F#/Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F']
const MINOR_LABEL = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m/Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm']

const C = 160 // centro
const R_OUT = 152
const R_MID = 108
const R_IN = 66

// Posição no círculo de uma nota: cada quinta (7 semitons) anda uma casa.
// 7 × 7 = 49 ≡ 1 (mod 12), então a posição é chroma × 7 (mod 12).
const positionOf = (chroma: number) => (chroma * 7) % 12

function sector(p: number, r1: number, r2: number) {
  const a0 = ((p - 0.5) * 30 - 90) * (Math.PI / 180)
  const a1 = ((p + 0.5) * 30 - 90) * (Math.PI / 180)
  const pt = (r: number, a: number) => `${C + r * Math.cos(a)} ${C + r * Math.sin(a)}`
  return `M ${pt(r2, a0)} A ${r2} ${r2} 0 0 1 ${pt(r2, a1)} L ${pt(r1, a1)} A ${r1} ${r1} 0 0 0 ${pt(r1, a0)} Z`
}
const labelAt = (p: number, r: number) => {
  const a = (p * 30 - 90) * (Math.PI / 180)
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) }
}

interface Props {
  chord: ChordRef
  mode: Mode
  onPick: (c: ChordRef) => void
}

export function CircleOfFifths({ chord, mode, onPick }: Props) {
  const chroma = Note.chroma(chord.root) ?? 0
  // Posição do tom maior de referência (para menor, usamos o relativo maior).
  const home = positionOf(mode === 'major' ? chroma : (chroma + 3) % 12)
  const dist = (p: number) => ((p - home + 18) % 12) - 6 // -6..5
  const info = keyInfo(chord.root, mode)

  const major = QUALITIES.find((q) => q.id === 'maior')!
  const minor = QUALITIES.find((q) => q.id === 'menor')!

  const outerRole = (p: number) => {
    const d = dist(p)
    if (d === 0) return mode === 'major' ? 'I' : 'III'
    if (d === -1) return mode === 'major' ? 'IV' : 'VI'
    if (d === 1) return mode === 'major' ? 'V' : 'VII'
    return null
  }
  const innerRole = (p: number) => {
    const d = dist(p)
    if (d === 0) return mode === 'major' ? 'vi' : 'i'
    if (d === -1) return mode === 'major' ? 'ii' : 'iv'
    if (d === 1) return mode === 'major' ? 'iii' : 'v'
    if (d === 2) return mode === 'major' ? 'vii°' : 'ii°' // o diminuto cai aqui
    return null
  }
  const isTonic = (ring: 'out' | 'in', p: number) =>
    dist(p) === 0 && ((ring === 'out' && mode === 'major') || (ring === 'in' && mode === 'minor'))

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-panel/80 p-3 backdrop-blur sm:p-5">
      <h2 className="font-display text-xl font-bold">Círculo de quintas</h2>
      <p className="mb-2 text-sm text-slate-400">
        Tom de {info.tonic} {mode === 'major' ? 'maior' : 'menor'} destacado, com os vizinhos do campo harmônico.
      </p>
      <svg viewBox="0 0 320 320" className="mx-auto w-full max-w-[340px]" role="img" aria-label="Círculo de quintas">
        {MAJORS.map((_, p) => {
          const role = outerRole(p)
          const tonic = isTonic('out', p)
          const l = labelAt(p, (R_OUT + R_MID) / 2)
          return (
            <g
              key={`o${p}`}
              className="cursor-pointer"
              onClick={() => onPick({ root: MAJORS[p], quality: major })}
            >
              <title>{`${MAJOR_LABEL[p]} maior`}</title>
              <path
                d={sector(p, R_MID, R_OUT)}
                fill={tonic ? '#7c5cff' : role ? 'rgba(124,92,255,0.28)' : 'rgba(255,255,255,0.03)'}
                stroke="#05060a"
                strokeWidth={2}
                className="transition-colors hover:brightness-150"
              />
              <text x={l.x} y={l.y - (role ? 3 : -5)} textAnchor="middle" fontSize={MAJOR_LABEL[p].length > 3 ? 12 : 16} fontWeight={700} fill={role ? '#fff' : '#94a3b8'} className="pointer-events-none font-display">
                {MAJOR_LABEL[p]}
              </text>
              {role && (
                <text x={l.x} y={l.y + 13} textAnchor="middle" fontSize={10} fill="#c4b5fd" className="pointer-events-none">
                  {role}
                </text>
              )}
            </g>
          )
        })}
        {MINORS.map((_, p) => {
          const role = innerRole(p)
          const tonic = isTonic('in', p)
          const l = labelAt(p, (R_MID + R_IN) / 2)
          return (
            <g key={`i${p}`} className="cursor-pointer" onClick={() => onPick({ root: MINORS[p], quality: minor })}>
              <title>{`${MINOR_LABEL[p]} (relativo de ${MAJOR_LABEL[p]})`}</title>
              <path
                d={sector(p, R_IN, R_MID)}
                fill={tonic ? '#22d3ee' : role ? 'rgba(34,211,238,0.22)' : 'rgba(255,255,255,0.02)'}
                stroke="#05060a"
                strokeWidth={2}
                className="transition-colors hover:brightness-150"
              />
              <text x={l.x} y={l.y - (role ? 2 : -4)} textAnchor="middle" fontSize={MINOR_LABEL[p].length > 4 ? 8 : 12} fontWeight={600} fill={tonic ? '#001722' : role ? '#e0f7fb' : '#7c8799'} className="pointer-events-none">
                {MINOR_LABEL[p]}
              </text>
              {role && (
                <text x={l.x} y={l.y + 11} textAnchor="middle" fontSize={9} fill={tonic ? '#001722' : '#67e8f9'} className="pointer-events-none">
                  {role}
                </text>
              )}
            </g>
          )
        })}
        {/* Centro: o tom e a armadura */}
        <circle cx={C} cy={C} r={R_IN - 4} fill="#0d1019" />
        <text x={C} y={C - 4} textAnchor="middle" fontSize={20} fontWeight={700} fill="#fff" className="font-display">
          {info.tonic}
          {mode === 'minor' ? 'm' : ''}
        </text>
        <text x={C} y={C + 16} textAnchor="middle" fontSize={11} fill="#94a3b8">
          {info.alteration === 0 ? 'sem acidentes' : `${Math.abs(info.alteration)} ${info.alteration > 0 ? '♯' : '♭'}`}
        </text>
      </svg>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        Horário: sobe uma quinta e ganha um ♯. Anti-horário: sobe uma quarta e ganha um ♭. Por dentro, o relativo menor de cada tom.
        Toque num tom para vê-lo no braço.
      </p>
    </section>
  )
}
