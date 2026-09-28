import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { THEMES, setTheme, useTheme } from '../lib/themes'

// Botão "Tema" no topo: abre a lista de paletas. A escolha fica salva.
export function ThemePicker() {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Escolher tema de cores"
        className="btn btn-round h-10 gap-1.5 px-3"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
          <path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.8-.9 1.8-1.9 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Zm-5.5 9A1.5 1.5 0 1 1 8 10.5 1.5 1.5 0 0 1 6.5 12Zm3-4A1.5 1.5 0 1 1 11 6.5 1.5 1.5 0 0 1 9.5 8Zm5 0A1.5 1.5 0 1 1 16 6.5 1.5 1.5 0 0 1 14.5 8Zm3 4a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5Z" />
        </svg>
        <span className="hidden sm:inline">Tema</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="menu"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-40 mt-2 w-64 rounded-2xl border border-line bg-panel p-1.5 shadow-2xl"
          >
            {THEMES.map((t) => {
              const active = t.id === theme.id
              return (
                <li key={t.id}>
                  <button
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      setTheme(t.id)
                      setOpen(false)
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
                      active ? 'bg-accent/15' : 'hover:bg-white/5'
                    }`}
                  >
                    {/* Amostra: fundo do tema com as cores principais */}
                    <span
                      className="flex h-9 w-14 shrink-0 items-center justify-center gap-0.5 rounded-lg border"
                      style={{ background: t.ui.ink, borderColor: t.ui.line }}
                      aria-hidden
                    >
                      {[t.ui.accent, t.degrees.root.color, t.degrees.third.color, t.degrees.fifth.color].map((c, i) => (
                        <i key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{t.name}</span>
                      <span className="block truncate text-xs text-slate-400">{t.hint}</span>
                    </span>
                    {active && <span className="text-accent">✓</span>}
                  </button>
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
