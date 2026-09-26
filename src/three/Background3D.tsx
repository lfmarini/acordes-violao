import { Float } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Mesh } from 'three'
import { DPR, useFrameloop } from './useFrameloop'

// Fundo decorativo: formas em arame girando devagar, bem apagadas,
// para não competir com o diagrama.
function Shape({ position, color, speed, kind }: { position: [number, number, number]; color: string; speed: number; kind: 'ico' | 'torus' }) {
  const ref = useRef<Mesh>(null)
  useFrame((_, dt) => {
    if (!ref.current) return
    ref.current.rotation.x += dt * speed * 0.3
    ref.current.rotation.y += dt * speed * 0.5
  })
  return (
    <Float speed={speed} rotationIntensity={0.3} floatIntensity={0.8}>
      <mesh ref={ref} position={position}>
        {kind === 'ico' ? <icosahedronGeometry args={[1.6, 1]} /> : <torusGeometry args={[1.3, 0.35, 12, 48]} />}
        <meshBasicMaterial color={color} wireframe transparent opacity={0.16} />
      </mesh>
    </Float>
  )
}

export default function Background3D() {
  const frameloop = useFrameloop()
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <Canvas frameloop={frameloop} dpr={DPR} camera={{ position: [0, 0, 8], fov: 50 }} gl={{ antialias: true, alpha: true }}>
        <Shape position={[-5, 2.5, -2]} color="#7c5cff" speed={0.6} kind="ico" />
        <Shape position={[5.5, -2.2, -3]} color="#22d3ee" speed={0.45} kind="torus" />
        <Shape position={[4, 3.5, -5]} color="#ff5c6c" speed={0.35} kind="ico" />
      </Canvas>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(124,92,255,0.12),transparent_60%)]" />
    </div>
  )
}
