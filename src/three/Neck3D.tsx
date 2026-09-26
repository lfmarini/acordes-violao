import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { windowSize, type Shape } from '../lib/chords'
import { DEGREES, chromaAt, type Analysis } from '../lib/theory'
import { DPR, useFrameloop } from './useFrameloop'

// Visão 3D opcional, só pela estética. O diagrama 2D continua sendo a
// referência para estudar (a perspectiva distorce a distância entre casas).
const SG = 0.5
const FG = 1.1

export default function Neck3D({ shape, analysis, lefty }: { shape: Shape | null; analysis: Analysis; lefty: boolean }) {
  const frameloop = useFrameloop()
  const base = shape?.baseFret ?? 1
  const frets = windowSize(shape)
  const x = (s: number) => ((lefty ? 5 - s : s) - 2.5) * SG
  const y = (f: number) => (frets / 2 - (f - base + 0.5)) * FG
  const color = (s: number, f: number) => {
    const m = analysis.byChroma.get(chromaAt(s, f))
    return m ? DEGREES[m.degree].color : '#e5e9f0'
  }
  return (
    <div className="aspect-[3/4] w-full overflow-hidden rounded-2xl border border-line bg-panel">
      <Canvas frameloop={frameloop} dpr={DPR} camera={{ position: [2.2, -1.5, 6.5], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 4, 6]} intensity={1.4} />
        {/* madeira */}
        <mesh position={[0, 0, -0.12]}>
          <boxGeometry args={[6 * SG + 0.3, frets * FG + 0.2, 0.2]} />
          <meshStandardMaterial color="#3a2616" roughness={0.8} />
        </mesh>
        {/* trastes */}
        {Array.from({ length: frets + 1 }, (_, k) => (
          <mesh key={k} position={[0, (frets / 2 - k) * FG, 0]}>
            <boxGeometry args={[6 * SG + 0.3, k === 0 && base === 1 ? 0.14 : 0.05, 0.06]} />
            <meshStandardMaterial color={k === 0 && base === 1 ? '#f3efe6' : '#b8bfcc'} metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
        {/* cordas */}
        {Array.from({ length: 6 }, (_, s) => (
          <mesh key={s} position={[x(s), 0, 0.05]}>
            <cylinderGeometry args={[0.012 + (5 - s) * 0.004, 0.012 + (5 - s) * 0.004, frets * FG + 0.2, 8]} />
            <meshStandardMaterial color={s < 3 ? '#d8c29a' : '#e3e8f0'} metalness={0.9} roughness={0.25} />
          </mesh>
        ))}
        {/* dedos */}
        {shape?.frets.map((f, s) =>
          f > 0 ? (
            <mesh key={`d${s}`} position={[x(s), y(f), 0.15]}>
              <sphereGeometry args={[0.17, 24, 24]} />
              <meshStandardMaterial color={color(s, f)} emissive={color(s, f)} emissiveIntensity={0.35} />
            </mesh>
          ) : null,
        )}
        <OrbitControls enablePan={false} minDistance={4} maxDistance={12} />
      </Canvas>
    </div>
  )
}
