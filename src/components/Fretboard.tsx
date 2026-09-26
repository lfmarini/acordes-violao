import { AnimatePresence, motion } from 'framer-motion'
import { STRING_NAMES, STRING_NOTES, windowSize, type Shape } from '../lib/chords'
import { DEGREES, chromaAt, type Analysis } from '../lib/theory'

// ---------------------------------------------------------------------------
// Braço do violão em SVG 2D, na vertical (como nas revistas de cifra):
// a pestana (nut) fica em cima, as casas descem e as cordas são as linhas
// verticais. No modo destro a 6ª corda (Mi grave) fica à esquerda e a 1ª
// (Mi agudo) à direita; no modo canhoto o desenho é espelhado.
// ---------------------------------------------------------------------------

const SG = 44 // distância entre cordas
const FG = 62 // altura de cada casa
const LEFT = 52
const RIGHT = 52
const STRING_WIDTH = [3.4, 2.8, 2.3, 1.8, 1.4, 1.1] // 6ª é a mais grossa
const INLAYS = [3, 5, 7, 9] // e as mesmas uma oitava acima (15, 17...)
const MUTED_COLOR = '#ff6b6b'
const NEUTRAL = '#e5e9f0'

export interface FretboardProps {
  shape: Shape | null
  analysis?: Analysis | null
  showFingers?: boolean
  lefty?: boolean
  highlight?: number | null // chroma da nota destacada pelo painel
  plucked?: Record<number, number> // corda -> momento do ataque (para o brilho)
  mini?: boolean
  className?: string
}

export function Fretboard({
  shape,
  analysis,
  showFingers = true,
  lefty = false,
  highlight = null,
  plucked = {},
  mini = false,
  className,
}: FretboardProps) {
  const base = shape?.baseFret ?? 1
  const frets = windowSize(shape)
  const top = mini ? 34 : 70
  const bottom = mini ? 10 : 62
  const width = LEFT + 5 * SG + RIGHT
  const height = top + frets * FG + bottom

  const x = (s: number) => LEFT + (lefty ? 5 - s : s) * SG
  const y = (fret: number) => top + (fret - base + 0.5) * FG

  const colorAt = (s: number, fret: number) => {
    const member = analysis?.byChroma.get(chromaAt(s, fret))
    return member ? DEGREES[member.degree] : { color: NEUTRAL, ink: '#0b0d12' }
  }
  const dim = (s: number, fret: number) => highlight !== null && chromaAt(s, fret) !== highlight

  // Cada círculo recebe uma "chave" pelo número do dedo. Assim, ao trocar de
  // acorde, o dedo 2 (por exemplo) desliza até a nova posição em vez de sumir.
  const dots: { key: string; s: number; fret: number; finger: number }[] = []
  const usedKeys = new Set<string>()
  shape?.frets.forEach((fret, s) => {
    if (fret <= 0) return
    const finger = shape.fingers[s]
    let key = finger > 0 ? `f${finger}` : `s${s}`
    if (usedKeys.has(key)) key = `s${s}`
    usedKeys.add(key)
    dots.push({ key, s, fret, finger })
  })

  // Posições de "fantasma" quando um grau do painel é destacado: todas as
  // casas visíveis (e cordas soltas) onde aquela nota aparece.
  const ghosts: { s: number; fret: number }[] = []
  if (highlight !== null && !mini) {
    for (let s = 0; s < 6; s++) {
      const candidates = base === 1 ? [0] : []
      for (let f = base; f < base + frets; f++) candidates.push(f)
      for (const f of candidates) if (chromaAt(s, f) === highlight) ghosts.push({ s, fret: f })
    }
  }

  const r = 17
  const xoY = top - (mini ? 17 : 26)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={shape ? `Diagrama do acorde, a partir da ${base}ª casa` : 'Braço do violão vazio'}
    >
      {/* Madeira do braço */}
      <rect x={LEFT - 22} y={top} width={5 * SG + 44} height={frets * FG} rx={6} fill="#141824" />

      {/* Marcações do braço (bolinhas nas casas 3, 5, 7, 9, 12...) */}
      {Array.from({ length: frets }, (_, k) => base + k).map((f) =>
        f % 12 === 0 ? (
          <g key={`in${f}`} fill="#262c3d">
            <circle cx={LEFT + 1.5 * SG} cy={y(f)} r={7} />
            <circle cx={LEFT + 3.5 * SG} cy={y(f)} r={7} />
          </g>
        ) : INLAYS.includes(f % 12) ? (
          <circle key={`in${f}`} cx={LEFT + 2.5 * SG} cy={y(f)} r={7} fill="#262c3d" />
        ) : null,
      )}

      {/* Trastes */}
      {Array.from({ length: frets + 1 }, (_, k) => (
        <line
          key={`t${k}`}
          x1={LEFT - 22}
          x2={LEFT + 5 * SG + 22}
          y1={top + k * FG}
          y2={top + k * FG}
          stroke="#8a93a8"
          strokeWidth={k === 0 && base === 1 ? 0 : 2}
        />
      ))}

      {/* Pestana do violão (nut): barra grossa quando a janela começa na 1ª casa */}
      {base === 1 && (
        <rect x={LEFT - 22} y={top - 7} width={5 * SG + 44} height={9} rx={2} fill="#f3efe6" />
      )}

      {/* Número da casa inicial, ao lado do diagrama */}
      {!mini && base > 1 && (
        <text
          x={lefty ? width - 4 : 6}
          y={y(base) + 7}
          textAnchor={lefty ? 'end' : 'start'}
          className="fill-white font-display"
          fontSize={20}
          fontWeight={700}
        >
          {base}ª
        </text>
      )}
      {mini && base > 1 && (
        <text x={lefty ? width - 4 : 8} y={y(base) + 8} textAnchor={lefty ? 'end' : 'start'} fill="#cbd5e1" fontSize={26} fontWeight={700}>
          {base}
        </text>
      )}

      {/* Cordas */}
      {STRING_WIDTH.map((w, s) => {
        const muted = shape ? shape.frets[s] < 0 : false
        return (
          <line
            key={`c${s}`}
            x1={x(s)}
            x2={x(s)}
            y1={top}
            y2={top + frets * FG}
            stroke={s < 3 ? '#d8c29a' : '#e3e8f0'}
            strokeOpacity={muted ? 0.35 : 0.95}
            strokeWidth={w}
          />
        )
      })}

      {/* Brilho da corda no momento em que é atacada pelo play */}
      {Object.entries(plucked).map(([sKey, stamp]) => {
        const s = Number(sKey)
        const fret = shape?.frets[s] ?? 0
        return (
          <motion.line
            key={`p${s}-${stamp}`}
            x1={x(s)}
            x2={x(s)}
            y1={top}
            y2={top + frets * FG}
            stroke={colorAt(s, Math.max(fret, 0)).color}
            strokeLinecap="round"
            initial={{ opacity: 1, strokeWidth: 9 }}
            animate={{ opacity: 0, strokeWidth: 3 }}
            transition={{ duration: 1.1, ease: 'easeOut' }}
          />
        )
      })}

      {/* X (não tocar) e O (corda solta que soa), acima da pestana */}
      {shape?.frets.map((fret, s) => {
        if (fret < 0) {
          const d = mini ? 8 : 10
          return (
            <g key={`xo${s}`} stroke={MUTED_COLOR} strokeWidth={mini ? 4 : 4.5} strokeLinecap="round">
              <line x1={x(s) - d} y1={xoY - d} x2={x(s) + d} y2={xoY + d} />
              <line x1={x(s) - d} y1={xoY + d} x2={x(s) + d} y2={xoY - d} />
            </g>
          )
        }
        if (fret === 0) {
          const c = colorAt(s, 0)
          return (
            <circle
              key={`xo${s}`}
              cx={x(s)}
              cy={xoY}
              r={mini ? 9 : 11}
              fill="none"
              stroke={c.color}
              strokeWidth={mini ? 4 : 4.5}
              opacity={dim(s, 0) ? 0.3 : 1}
            />
          )
        }
        return null
      })}

      {/* Pestana (barre): barra contínua ligando as cordas */}
      <AnimatePresence>
        {shape?.barres.map((b) => {
          const x1 = Math.min(x(b.from), x(b.to)) - r
          const x2 = Math.max(x(b.from), x(b.to)) + r
          return (
            <motion.rect
              key={`b${b.fret}-${b.finger}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, x: x1, y: y(b.fret) - r, width: x2 - x1 }}
              exit={{ opacity: 0 }}
              height={r * 2}
              rx={r}
              fill="rgba(229,233,240,0.42)"
              stroke="rgba(255,255,255,0.75)"
              strokeWidth={2}
            />
          )
        })}
      </AnimatePresence>

      {/* Posições fantasma do grau destacado */}
      {ghosts.map((g) => (
        <circle
          key={`g${g.s}-${g.fret}`}
          cx={x(g.s)}
          cy={g.fret === 0 ? xoY : y(g.fret)}
          r={r + 3}
          fill="none"
          stroke={colorAt(g.s, g.fret).color}
          strokeWidth={2.5}
          strokeDasharray="5 4"
        />
      ))}

      {/* Dedos */}
      <AnimatePresence>
        {dots.map((d) => {
          const c = colorAt(d.s, d.fret)
          return (
            <motion.g
              key={d.key}
              initial={{ x: x(d.s), y: y(d.fret), scale: 0, opacity: 0 }}
              animate={{ x: x(d.s), y: y(d.fret), scale: 1, opacity: dim(d.s, d.fret) ? 0.3 : 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            >
              <circle r={r} fill={c.color} stroke="rgba(0,0,0,0.45)" strokeWidth={2} />
              {showFingers && !mini && d.finger > 0 && (
                <text textAnchor="middle" dy={6.5} fontSize={19} fontWeight={800} fill={c.ink}>
                  {d.finger}
                </text>
              )}
            </motion.g>
          )
        })}
      </AnimatePresence>

      {/* Nome das cordas embaixo: número e nota */}
      {!mini &&
        STRING_NAMES.map((name, s) => (
          <g key={`n${s}`} textAnchor="middle">
            <text x={x(s)} y={top + frets * FG + 26} fontSize={15} fontWeight={700} fill="#e2e8f0">
              {name}
            </text>
            <text x={x(s)} y={top + frets * FG + 47} fontSize={14} fill="#94a3b8">
              {STRING_NOTES[s]}
            </text>
          </g>
        ))}
    </svg>
  )
}
