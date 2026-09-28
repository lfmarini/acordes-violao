import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { ChordCapture } from './components/ChordCapture'
import { ChordPicker } from './components/ChordPicker'
import { Fretboard } from './components/Fretboard'
import { CircleOfFifths } from './components/CircleOfFifths'
import { HarmonicField } from './components/HarmonicField'
import { Learning } from './components/Learning'
import { MusikPlayer } from './components/MusikPlayer'
import { ThemePicker } from './components/ThemePicker'
import { TheoryPanel } from './components/TheoryPanel'
import { defaultMode, type Mode } from './lib/harmony'
import { VariationsBar } from './components/VariationsBar'
import { STRUM_DELAY_MS, STRUM_MAX_MS, STRUM_MIN_MS, playShape, setVolume } from './lib/audio'
import { QUALITIES, chordDisplayName, shapesFor, type ChordRef } from './lib/chords'
import { useStoredState } from './lib/storage'
import { DEGREES, analyze, type DegreeId } from './lib/theory'
import { useTheme } from './lib/themes'

// O fundo 3D fica fora do pacote inicial: só é baixado depois que a tela aparece.
const Background3D = lazy(() => import('./three/Background3D'))

const TABS = [
  { id: 'acordes', label: 'Acordes' },
  { id: 'aprendizado', label: 'Aprendizado' },
  { id: 'musik', label: 'Musik player' },
] as const
type TabId = (typeof TABS)[number]['id']

type StoredChord = { root: string; q: string }
const toRef = (c: StoredChord): ChordRef => ({
  root: c.root,
  quality: QUALITIES.find((q) => q.id === c.q) ?? QUALITIES[0],
})
const keyOf = (c: ChordRef) => `${c.root}|${c.quality.id}`

export default function App() {
  const theme = useTheme()
  const [stored, setStored] = useStoredState<StoredChord>('ultimo-acorde', { root: 'C', q: 'maior' })
  const [fingers, setFingers] = useStoredState('dedos', true)
  const [lefty, setLefty] = useStoredState('canhoto', false)
  const [volume, setVol] = useStoredState('volume', 0.8)
  const [muted, setMuted] = useStoredState('mudo', false)
  const [strumMs, setStrumMs] = useStoredState('velocidade-ataque', STRUM_DELAY_MS)
  const [favorites, setFavorites] = useStoredState<string[]>('favoritos', [])
  // Quantas vezes escolhi a posição aberta vs. outras (para abrir já na preferida).
  const [openStats, setOpenStats] = useStoredState('preferencia-aberta', { open: 1, other: 0 })
  const [highlight, setHighlight] = useState<number | null>(null)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [tab, setTab] = useStoredState<TabId>('aba', 'acordes')
  // Aberto pelo "Compartilhar" do celular (MIDI de acordes): vai direto para o Musik player.
  useEffect(() => {
    if (new URLSearchParams(location.search).has('compartilhado')) setTab('musik')
  }, [setTab])
  // Tonalidade do campo harmônico: segue o acorde, mas pode ser trocada à mão.
  const [modeOverride, setModeOverride] = useState<Mode | null>(null)
  const [plucked, setPlucked] = useState<Record<number, number>>({})
  const [bgReady, setBgReady] = useState(false)

  const chord = useMemo(() => toRef(stored), [stored])
  const shapes = useMemo(() => shapesFor(chord), [chord])
  const analysis = useMemo(() => analyze(chord), [chord])
  const mode = modeOverride ?? defaultMode(chord)

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
    setModeOverride(null)
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
      if (tab !== 'acordes' || tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowRight') selectVariation(index + 1)
      if (e.key === 'ArrowLeft') selectVariation(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, selectVariation, tab])

  useEffect(() => setVolume(volume, muted), [volume, muted])

  // O fundo 3D só começa a carregar depois que a tela principal apareceu.
  useEffect(() => {
    const id = window.setTimeout(() => setBgReady(true), 600)
    return () => clearTimeout(id)
  }, [])

  const play = () => {
    if (!shape) return
    setPlucked({})
    playShape(shape, volume, muted, strumMs, (s) => setPlucked((p) => ({ ...p, [s]: performance.now() })))
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
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl min-w-0 flex-col gap-5 px-2 pt-5 pb-10 sm:px-6">
        <header className="relative z-30 flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Acordes <span className="text-accent-2">Violão</span>
            </h1>
            <Signature className="-mt-1 mb-0.5 block text-sm leading-relaxed" />
            <p className="text-sm text-slate-400">Forma no braço, teoria de cada grau e som.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
          <ThemePicker />
          <button
            onClick={() => setCaptureOpen(true)}
            className="flex shrink-0 items-center gap-2 rounded-full bg-gradient-to-r from-accent to-accent-2 px-4 py-2.5 text-sm font-semibold text-[#fff] shadow-lg shadow-accent/30 transition hover:scale-105 active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
            </svg>
            <span>
              Capturar<span className="hidden sm:inline"> acorde</span>
            </span>
          </button>
          </div>
        </header>
        <ChordCapture
          open={captureOpen}
          onClose={() => setCaptureOpen(false)}
          onPick={(c) => {
            changeChord(c)
            setTab('acordes')
          }}
        />

        {/* Abas */}
        <nav className="flex gap-1 rounded-full border border-line bg-panel/70 p-1 text-sm backdrop-blur sm:w-fit" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-full px-2 py-2 font-semibold whitespace-nowrap transition sm:flex-none sm:px-5 ${
                tab === t.id ? 'bg-accent text-[#fff] shadow-lg shadow-accent/30' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* A aba escondida continua montada: o metrônomo segue tocando enquanto você olha os acordes. */}
        <div hidden={tab !== 'acordes'} className="flex flex-col gap-5">
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
                className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-[#fff] shadow-xl shadow-accent/40 transition hover:scale-105 active:scale-95 disabled:opacity-40"
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
                  className="w-24 accent-[var(--color-accent-2)]"
                />
              </div>
            </div>

            {/* Velocidade do ataque: o meio do cursor é o valor padrão */}
            <label className="flex w-full max-w-[460px] items-center gap-3 text-sm text-slate-300">
              <span className="shrink-0">Ataque</span>
              <span className="shrink-0 text-xs text-slate-500">rápido</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={strumToSlider(strumMs)}
                onChange={(e) => setStrumMs(sliderToStrum(Number(e.target.value)))}
                aria-label="Velocidade do ataque"
                aria-valuetext={`${strumMs} milissegundos entre as cordas`}
                className="min-w-0 flex-1 accent-[var(--color-accent)]"
              />
              <span className="shrink-0 text-xs text-slate-500">lento</span>
              <button
                onClick={() => setStrumMs(STRUM_DELAY_MS)}
                title="Voltar ao padrão"
                className="w-14 shrink-0 rounded-md bg-white/5 py-0.5 text-center text-xs tabular-nums text-slate-300 hover:bg-white/10"
              >
                {strumMs} ms
              </button>
            </label>

            {/* O herói da tela: o braço */}
            <div className="w-full max-w-[460px]">
              <Fretboard
                shape={shape}
                analysis={analysis}
                showFingers={fingers}
                lefty={lefty}
                highlight={highlight}
                plucked={plucked}
                className="w-full"
              />
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
                    <span className="h-3 w-3 rounded-full" style={{ background: theme.degrees[id as DegreeId].color }} />
                    {d.name}
                  </li>
                ))}
              <li className="flex items-center gap-1.5">
                <span className="font-bold" style={{ color: theme.board.muted }}>X</span> não tocar
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full border-2 border-slate-200" /> corda solta
              </li>
            </ul>

            <div className="w-full max-w-[640px]">
              <VariationsBar shapes={shapes} active={index} analysis={analysis} lefty={lefty} onSelect={selectVariation} />
            </div>
          </section>

          <div className="flex min-w-0 flex-col gap-6">
            <TheoryPanel chord={chord} analysis={analysis} highlight={highlight} onHighlight={setHighlight} />
            <HarmonicField chord={chord} mode={mode} onMode={setModeOverride} onPick={changeChord} />
            <CircleOfFifths chord={chord} mode={mode} onPick={changeChord} />
          </div>
        </div>
        </div>

        <div hidden={tab !== 'aprendizado'}>
          <Learning
            active={tab === 'aprendizado'}
            onPick={(c) => {
              changeChord(c)
              setTab('acordes')
            }}
          />
        </div>

        <div hidden={tab !== 'musik'}>
          <MusikPlayer active={tab === 'musik'} />
        </div>

        {/* Licença AGPL-3.0 (exigida pelo Essentia.js): o código-fonte fica aberto. */}
        <footer className={`mt-auto pt-6 text-center text-xs text-slate-500 ${tab === 'musik' ? 'pb-36' : ''}`}>
          <p className="mb-1.5 font-display text-sm text-slate-400">
            Acordes Violão <Signature />
          </p>
          Software livre (AGPL-3.0) ·{' '}
          <a href="https://github.com/lfmarini/acordes-violao" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-300">
            código-fonte
          </a>{' '}
          · letras do LRCLIB · análise de áudio com Essentia.js
        </footer>
      </div>
    </MotionConfig>
  )
}

// O cursor vai de 0 a 100 em escala logarítmica: o meio (50) dá ~32 ms,
// a ponta rápida 10 ms e a ponta lenta 100 ms entre uma corda e a próxima.
function sliderToStrum(v: number) {
  return Math.round(STRUM_MIN_MS * Math.pow(STRUM_MAX_MS / STRUM_MIN_MS, v / 100))
}
function strumToSlider(ms: number) {
  return Math.round((100 * Math.log(ms / STRUM_MIN_MS)) / Math.log(STRUM_MAX_MS / STRUM_MIN_MS))
}

// Assinatura: "por LFMarini", em letra cursiva (Great Vibes) com as cores de destaque do tema.
function Signature({ className = '' }: { className?: string }) {
  return (
    <span className={`text-slate-400 ${className}`}>
      por{' '}
      <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text px-0.5 font-signature text-[1.9em] leading-none text-transparent">
        LFMarini
      </span>
    </span>
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
