import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { ChordPicker } from './components/ChordPicker'
import { Fretboard } from './components/Fretboard'
import { TheoryPanel } from './components/TheoryPanel'
import { VariationsBar } from './components/VariationsBar'
import { playShape, setVolume } from './lib/audio'
import { QUALITIES, chordDisplayName, shapesFor, type ChordRef } from './lib/chords'
import { useStoredState } from './lib/storage'
import { DEGREES, analyze } from './lib/theory'

// A parte 3D fica fora do pacote inicial: só é baixada quando for usada.
const Background3D = lazy(() => import('./three/Background3D'))
const Neck3D = lazy(() => import('./three/Neck3D'))

type StoredChord = { root: string; q: string }
const toRef = (c: StoredChord): ChordRef => ({
  root: c.root,
  quality: QUALITIES.find((q) => q.id === c.q) ?? QUALITIES[0],
})
const keyOf = (c: ChordRef) => `${c.root}|${c.quality.id}`

export default function App() {
  const [stored, setStored] = useStoredState<StoredChord>('ultimo-acorde', { root: 'C', q: 'maior' })
  const [fingers, setFingers] = useStoredState('dedos', true)
  const [lefty, setLefty] = useStoredState('canhoto', false)
  const [volume, setVol] = useStoredState('volume', 0.8)
  const [muted, setMuted] = useStoredState('mudo', false)
  const [favorites, setFavorites] = useStoredState<string[]>('favoritos', [])
  // Quantas vezes escolhi a posição aberta vs. outras (para abrir já na preferida).
  const [openStats, setOpenStats] = useStoredState('preferencia-aberta', { open: 1, other: 0 })
  const [show3D, setShow3D] = useState(false)
  const [highlight, setHighlight] = useState<number | null>(null)
  const [plucked, setPlucked] = useState<Record<number, number>>({})
  const [bgReady, setBgReady] = useState(false)

  const chord = useMemo(() => toRef(stored), [stored])
  const shapes = useMemo(() => shapesFor(chord), [chord])
  const analysis = useMemo(() => analyze(chord), [chord])

  const preferredIndex = useCallback(
    (list: typeof shapes) => {
      const preferOpen = openStats.open >= openStats.other
      if (preferOpen) return 0 // a aberta, quando existe, é sempre a primeira
      const firstClosed = list.findIndex((s) => !s.isOpen)
      return firstClosed === -1 ? 0 : firstClosed
    },
    [openStats],
  )
  const [variation, setVariation] = useState(() => ({ key: keyOf(chord), index: preferredIndex(shapes) }))
  // Trocou de acorde: volta para a variação preferida.
  const index =
    variation.key === keyOf(chord) ? Math.min(variation.index, shapes.length - 1) : preferredIndex(shapes)
  const shape = shapes[index] ?? null

  const changeChord = (c: ChordRef) => {
    setStored({ root: c.root, q: c.quality.id })
    setVariation({ key: keyOf(c), index: preferredIndex(shapesFor(c)) })
    setHighlight(null)
  }

  const selectVariation = useCallback(
    (i: number) => {
      const next = Math.max(0, Math.min(i, shapes.length - 1))
      setVariation({ key: keyOf(chord), index: next })
      if (shapes[0]?.isOpen) {
        setOpenStats((s) => (next === 0 ? { ...s, open: s.open + 1 } : { ...s, other: s.other + 1 }))
      }
    },
    [chord, shapes, setOpenStats],
  )

  // Setas esquerda/direita navegam entre as variações (fora da caixa de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowRight') selectVariation(index + 1)
      if (e.key === 'ArrowLeft') selectVariation(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, selectVariation])

  useEffect(() => setVolume(volume, muted), [volume, muted])

  // O fundo 3D só começa a carregar depois que a tela principal apareceu.
  useEffect(() => {
    const id = window.setTimeout(() => setBgReady(true), 600)
    return () => clearTimeout(id)
  }, [])

  const play = () => {
    if (!shape) return
    setPlucked({})
    playShape(shape, volume, muted, (s) => setPlucked((p) => ({ ...p, [s]: performance.now() })))
  }

  const isFav = favorites.includes(keyOf(chord))
  const toggleFav = () =>
    setFavorites((f) => (isFav ? f.filter((k) => k !== keyOf(chord)) : [...f, keyOf(chord)]))

  const usedDegrees = new Set(analysis.members.map((m) => m.degree))

  return (
    // reducedMotion="user": se o sistema pedir menos movimento, as animações somem.
    <MotionConfig reducedMotion="user">
      {bgReady && (
        <Suspense fallback={null}>
          <Background3D />
        </Suspense>
      )}
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-5 px-4 pt-5 pb-10 sm:px-6">
        <header className="flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Acordes <span className="text-accent-2">Violão</span>
            </h1>
            <p className="text-sm text-slate-400">Forma no braço, teoria de cada grau e som.</p>
          </div>
        </header>

        <ChordPicker chord={chord} onChange={changeChord} />

        {favorites.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-amber-300">★ Favoritos</span>
            {favorites.map((k) => {
              const [root, q] = k.split('|')
              const ref = toRef({ root, q })
              const active = k === keyOf(chord)
              return (
                <button
                  key={k}
                  onClick={() => changeChord(ref)}
                  className={`rounded-full border px-3 py-1 font-display text-sm font-semibold ${
                    active ? 'border-amber-300 bg-amber-300/15 text-amber-200' : 'border-line text-slate-200 hover:border-slate-500'
                  }`}
                >
                  {chordDisplayName(ref)}
                </button>
              )
            })}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="flex min-w-0 flex-col items-center gap-4">
            {/* Nome do acorde, favorito e play */}
            <div className="flex w-full max-w-[460px] items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.h2
                      key={keyOf(chord)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="font-display text-5xl font-bold tracking-tight"
                    >
                      {chordDisplayName(chord)}
                    </motion.h2>
                  </AnimatePresence>
                  <button
                    onClick={toggleFav}
                    aria-pressed={isFav}
                    aria-label={isFav ? 'Remover dos favoritos' : 'Marcar como favorito'}
                    className={`text-3xl transition ${isFav ? 'text-amber-300' : 'text-slate-600 hover:text-slate-400'}`}
                  >
                    {isFav ? '★' : '☆'}
                  </button>
                </div>
                <p className="truncate text-sm text-slate-400">
                  {chord.quality.name} · {shape?.label ?? '—'}
                </p>
              </div>
              <button
                onClick={play}
                disabled={!shape}
                aria-label="Tocar o acorde"
                className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-white shadow-xl shadow-accent/40 transition hover:scale-105 active:scale-95 disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" className="ml-1 h-8 w-8" fill="currentColor" aria-hidden>
                  <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" />
                </svg>
              </button>
            </div>

            {/* Botões de opções */}
            <div className="flex w-full max-w-[460px] flex-wrap items-center gap-2 text-sm">
              <Toggle on={fingers} onClick={() => setFingers(!fingers)} label={`Dedos: ${fingers ? 'ligado' : 'desligado'}`} />
              <Toggle on={lefty} onClick={() => setLefty(!lefty)} label={lefty ? 'Canhoto' : 'Destro'} />
              <Toggle on={show3D} onClick={() => setShow3D(!show3D)} label="Visão 3D" />
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => setMuted(!muted)}
                  aria-label={muted ? 'Ligar o som' : 'Silenciar'}
                  className="rounded-lg px-2 py-1 text-lg text-slate-300 hover:bg-white/5"
                >
                  {muted || volume === 0 ? '🔇' : '🔊'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(e) => {
                    setVol(Number(e.target.value))
                    if (muted) setMuted(false)
                  }}
                  aria-label="Volume"
                  className="w-24 accent-[#22d3ee]"
                />
              </div>
            </div>

            {/* O herói da tela: o braço */}
            <div className="w-full max-w-[460px]">
              {show3D ? (
                <Suspense fallback={<div className="grid aspect-[3/4] place-items-center text-slate-500">Carregando 3D…</div>}>
                  <Neck3D shape={shape} analysis={analysis} lefty={lefty} />
                </Suspense>
              ) : (
                <Fretboard
                  shape={shape}
                  analysis={analysis}
                  showFingers={fingers}
                  lefty={lefty}
                  highlight={highlight}
                  plucked={plucked}
                  className="w-full"
                />
              )}
              <p className="mt-1 flex justify-between text-xs text-slate-400">
                {lefty ? (
                  <>
                    <span>1ª corda · Mi agudo</span>
                    <span>6ª corda · Mi grave</span>
                  </>
                ) : (
                  <>
                    <span>6ª corda · Mi grave</span>
                    <span>1ª corda · Mi agudo</span>
                  </>
                )}
              </p>
            </div>

            {/* Legenda das cores */}
            <ul className="flex w-full max-w-[460px] flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs" aria-label="Legenda das cores">
              {Object.entries(DEGREES)
                .filter(([id]) => ['root', 'third', 'fifth', 'seventh', 'ninth'].includes(id) || usedDegrees.has(id as never))
                .map(([id, d]) => (
                  <li key={id} className={`flex items-center gap-1.5 ${usedDegrees.has(id as never) ? '' : 'opacity-40'}`}>
                    <span className="h-3 w-3 rounded-full" style={{ background: d.color }} />
                    {d.name}
                  </li>
                ))}
              <li className="flex items-center gap-1.5">
                <span className="font-bold text-[#ff6b6b]">X</span> não tocar
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full border-2 border-slate-200" /> corda solta
              </li>
            </ul>

            <div className="w-full max-w-[640px]">
              <VariationsBar shapes={shapes} active={index} analysis={analysis} lefty={lefty} onSelect={selectVariation} />
            </div>
          </section>

          <TheoryPanel chord={chord} analysis={analysis} highlight={highlight} onHighlight={setHighlight} />
        </div>
      </div>
    </MotionConfig>
  )
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1.5 transition ${
        on ? 'border-accent bg-accent/20 text-white' : 'border-line text-slate-400 hover:border-slate-500'
      }`}
    >
      {label}
    </button>
  )
}
