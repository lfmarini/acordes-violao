import { MotionConfig } from 'framer-motion'
import { Fretboard } from './components/Fretboard'

export default function App() {
  return (
    // reducedMotion="user": se o sistema pedir menos movimento, as animações somem.
    <MotionConfig reducedMotion="user">
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 py-6">
        <header className="mb-6">
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Acordes <span className="text-accent-2">Violão</span>
          </h1>
          <p className="text-sm text-slate-400">Escolha um acorde e veja a forma no braço.</p>
        </header>
        <main className="flex justify-center">
          <Fretboard shape={null} className="w-full max-w-sm" />
        </main>
      </div>
    </MotionConfig>
  )
}
