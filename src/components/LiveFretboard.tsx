import { Note } from 'tonal'
import { OPEN_STRINGS, STRING_NAMES } from '../lib/chords'
import { readStored } from '../lib/storage'
import { TONE_NAMES, toneColor, useTheme } from '../lib/themes'

// ---------------------------------------------------------------------------
// Braço inteiro (casas 0 a 12) na horizontal, como numa tablatura: a 1ª corda
// (Mi agudo) em cima e a 6ª (Mi grave) embaixo. Cada nota que o microfone
// identifica acende em TODAS as casas onde aquela mesma nota (com a oitava)
// pode ser tocada — ex.: A2 = 5ª corda solta ou 6ª corda casa 5.
// Cada nota tem a sua cor (paleta de tons) e vai esvaecendo até sumir, no
// tempo de um compasso do metrônomo (`fadeMs`). Tocou de novo, reacende.
// ---------------------------------------------------------------------------

export const LAST_FRET = 12
/** Tempo padrão (ms) até a nota sumir, se ninguém informar o do compasso. */
export const HIT_FADE_MS = 2000

const OPEN_MIDI = OPEN_STRINGS.map((n) => Note.midi(n)!) // 40, 45, 50, 55, 59, 64
const INLAYS = [3, 5, 7, 9]

/** Casas (corda, casa) onde uma nota exata pode ser tocada. */
function positionsOf(midi: number) {
  const out: { s: number; fret: number }[] = []
  OPEN_MIDI.forEach((open, s) => {
    const fret = midi - open
    if (fret >= 0 && fret <= LAST_FRET) out.push({ s, fret })
  })
  return out
}

interface Props {
  hits: Map<number, number> // nota MIDI -> quando foi ouvida por último (performance.now)
  now: number
  on: boolean
  /** Dentro de outro quadro (ex.: no quadro de amplitude, acima de "Salvar gravação"). */
  embedded?: boolean
  /** Tempo (ms) até a nota sumir: um compasso do metrônomo. */
  fadeMs?: number
  /** Texto curto explicando esse tempo (ex.: "1 compasso de 4 tempos a 120 BPM"). */
  fadeHint?: string
}

export function LiveFretboard({ hits, now, on, embedded = false, fadeMs = HIT_FADE_MS, fadeHint }: Props) {
  const theme = useTheme()
  const B = theme.board
  const lefty = readStored('canhoto', false)

  const W = 720
  const LEFT = 44 // espaço para o nome das cordas
  const OPEN_W = 34 // coluna da corda solta, antes da pestana
  const FW = (W - LEFT - OPEN_W - 12) / LAST_FRET
  const TOP = 14
  const SG = 26
  const H = TOP + 5 * SG + 34

  // x do centro de uma casa (0 = corda solta, à esquerda da pestana)
  const cx = (fret: number) => {
    const x = fret === 0 ? LEFT + OPEN_W / 2 : LEFT + OPEN_W + (fret - 0.5) * FW
    return lefty ? W - x : x
  }
  const wireX = (k: number) => {
    const x = LEFT + OPEN_W + k * FW
    return lefty ? W - x : x
  }
  // 1ª corda (índice 5) em cima, 6ª (índice 0) embaixo
  const cy = (s: number) => TOP + (5 - s) * SG

  // Cor de cada nota pela paleta de tons (a mesma nota, a mesma cor).
  const colorOf = (midi: number) => toneColor(midi % 12, theme)

  const active = [...hits.entries()]
    .map(([midi, at]) => ({ midi, at, age: now - at }))
    .filter((h) => h.age < fadeMs)
    .sort((a, b) => a.midi - b.midi)
  const soundingPcs = new Set(active.map((h) => h.midi % 12))
  const secs = (fadeMs / 1000).toFixed(1).replace('.', ',')

  return (
    // Dentro de outro quadro (embedded): moldura leve, sem borda dupla.
    <section
      className={
        embedded
          ? 'mt-4 min-w-0 rounded-xl border border-line bg-black/20 p-3'
          : 'min-w-0 rounded-2xl border border-line bg-panel/80 p-3 backdrop-blur sm:p-6'
      }
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={`font-display font-bold ${embedded ? 'text-base' : 'text-xl'}`}>Violão virtual</h2>
        <span className="text-xs text-slate-400">
          {on ? 'cada nota ouvida acende onde pode ser tocada' : 'ligue o microfone no quadro de amplitude'} · some em {secs} s
          {fadeHint ? ` (${fadeHint})` : ''}
        </span>
      </div>

      <div className="scroll-thin overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label="Braço do violão com as notas identificadas">
          <rect x={Math.min(wireX(0), wireX(LAST_FRET))} y={TOP - 10} width={Math.abs(wireX(LAST_FRET) - wireX(0))} height={5 * SG + 20} rx={4} fill={B.wood} />

          {/* marcações das casas 3, 5, 7, 9 e 12 */}
          {Array.from({ length: LAST_FRET }, (_, i) => i + 1).map((f) =>
            f === 12 ? (
              <g key={f} fill={B.inlay}>
                <circle cx={cx(f)} cy={TOP + 1.5 * SG} r={5} />
                <circle cx={cx(f)} cy={TOP + 3.5 * SG} r={5} />
              </g>
            ) : INLAYS.includes(f) ? (
              <circle key={f} cx={cx(f)} cy={TOP + 2.5 * SG} r={5} fill={B.inlay} />
            ) : null,
          )}

          {/* trastes e pestana */}
          {Array.from({ length: LAST_FRET + 1 }, (_, k) => (
            <line key={k} x1={wireX(k)} x2={wireX(k)} y1={TOP - 10} y2={TOP + 5 * SG + 10} stroke={k === 0 ? B.nut : B.fret} strokeWidth={k === 0 ? 6 : 2} />
          ))}

          {/* cordas e nomes */}
          {OPEN_STRINGS.map((open, s) => (
            <g key={s}>
              <line
                x1={Math.min(cx(0) - OPEN_W / 2, wireX(LAST_FRET))}
                x2={Math.max(cx(0) + OPEN_W / 2, wireX(LAST_FRET))}
                y1={cy(s)}
                y2={cy(s)}
                stroke={s < 3 ? B.wound : B.plain}
                strokeWidth={3.2 - s * 0.4}
                strokeOpacity={0.9}
              />
              <text x={lefty ? W - 4 : 4} y={cy(s) + 4} textAnchor={lefty ? 'end' : 'start'} fontSize={11} fontWeight={700} fill={B.label}>
                {STRING_NAMES[s]} <tspan fill={B.sub} fontWeight={400}>{open.replace(/\d/, '')}</tspan>
              </text>
            </g>
          ))}

          {/* números das casas */}
          {Array.from({ length: LAST_FRET + 1 }, (_, f) => (
            <text key={f} x={cx(f)} y={H - 6} textAnchor="middle" fontSize={11} fill={B.sub}>
              {f === 0 ? 'solta' : f}
            </text>
          ))}

          {/* Notas identificadas. A chave inclui o instante em que a nota foi
              ouvida: tocou de novo, o elemento é recriado e o esvaecer recomeça. */}
          {active.flatMap(({ midi, at }) => {
            const c = colorOf(midi)
            const name = Note.fromMidiSharps(midi)
            return positionsOf(midi).map(({ s, fret }) => (
              <g key={`${midi}-${s}-${at}`} className="fret-fade" style={{ animationDuration: `${fadeMs}ms` }}>
                <circle cx={cx(fret)} cy={cy(s)} r={11.5} fill={c.color} stroke="rgba(0,0,0,0.35)" strokeWidth={1.5} />
                <text x={cx(fret)} y={cy(s) + 3.5} textAnchor="middle" fontSize={name.length > 2 ? 8 : 9.5} fontWeight={800} fill={c.ink}>
                  {name}
                </text>
              </g>
            ))
          })}
        </svg>
      </div>

      {/* Legenda da paleta de tons: as notas que estão soando ficam destacadas. */}
      <div className="mt-2 flex flex-wrap gap-1" aria-label="Cores de cada nota">
        {TONE_NAMES.map((n, pc) => {
          const c = toneColor(pc, theme)
          const lit = soundingPcs.has(pc)
          return (
            <span
              key={n}
              className={`rounded-md px-1.5 py-0.5 font-display text-[11px] font-bold transition ${lit ? 'scale-110 shadow' : 'opacity-60'}`}
              style={{ background: c.color, color: c.ink }}
            >
              {n}
            </span>
          )
        })}
      </div>

      {/* Lista em texto: onde tocar cada nota ouvida */}
      <ul className="mt-2 space-y-0.5 text-xs text-slate-400">
        {active.length === 0 ? (
          <li>{on ? 'Toque uma nota ou um acorde…' : 'Nenhuma nota ainda.'}</li>
        ) : (
          active.map(({ midi }) => (
            <li key={midi}>
              <strong className="font-display text-slate-200">{Note.fromMidiSharps(midi)}</strong>:{' '}
              {positionsOf(midi)
                .map(({ s, fret }) => `${STRING_NAMES[s]} corda ${fret === 0 ? 'solta' : `casa ${fret}`}`)
                .join(' · ') || 'fora das casas 0 a 12'}
            </li>
          ))
        )}
      </ul>
    </section>
  )
}
