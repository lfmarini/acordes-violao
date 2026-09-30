import type { Shape } from '../lib/chords'

// Diagrama pequeno de acorde (6 cordas × 4 casas), para o modo "troca de
// acordes" do treino de ritmo. Cordas na vertical, a 6ª (mais grave) à esquerda.
export function ChordMini({ shape, className = '' }: { shape: Shape | null; className?: string }) {
  if (!shape) return null
  const frets = 4
  const base = shape.baseFret <= 1 ? 1 : shape.baseFret
  const x = (s: number) => 10 + s * 12
  const y = (f: number) => 14 + f * 14
  return (
    <svg viewBox="0 0 80 76" className={className} role="img" aria-label="Diagrama do acorde">
      {/* Pestana do braço (só na 1ª casa) */}
      {base === 1 && <rect x={x(0)} y={y(0) - 2} width={x(5) - x(0)} height={3} className="fill-current" />}
      {Array.from({ length: frets + 1 }, (_, f) => (
        <line key={`f${f}`} x1={x(0)} x2={x(5)} y1={y(f)} y2={y(f)} className="stroke-current opacity-40" strokeWidth={1} />
      ))}
      {Array.from({ length: 6 }, (_, s) => (
        <line key={`s${s}`} x1={x(s)} x2={x(s)} y1={y(0)} y2={y(frets)} className="stroke-current opacity-60" strokeWidth={1} />
      ))}
      {base > 1 && (
        <text x={x(5) + 5} y={y(0) + 10} fontSize={8} className="fill-current">
          {base}ª
        </text>
      )}
      {shape.barres.map((b, i) => (
        <rect
          key={`b${i}`}
          x={x(b.from) - 4}
          y={y(b.fret - base) + 3}
          width={x(b.to) - x(b.from) + 8}
          height={8}
          rx={4}
          className="fill-current"
        />
      ))}
      {shape.frets.map((f, s) =>
        f < 0 ? (
          <text key={s} x={x(s)} y={9} fontSize={8} textAnchor="middle" className="fill-current opacity-70">
            ×
          </text>
        ) : f === 0 ? (
          <circle key={s} cx={x(s)} cy={6} r={2.6} className="fill-none stroke-current" strokeWidth={1} />
        ) : (
          <circle key={s} cx={x(s)} cy={y(f - base) + 7} r={4} className="fill-current" />
        ),
      )}
    </svg>
  )
}
