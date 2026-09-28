import { useEffect, useRef, useState } from 'react'
import { searchUrl } from '../lib/songLinks'
import { useStoredState } from '../lib/storage'
import { createYouTubePlayer, type YTPlayer } from '../lib/youtube'

// ---------------------------------------------------------------------------
// Vídeo da música (a mesma gravação usada pelo Chordify), embutido e
// recolhível. Recolher só esconde a imagem: o som continua tocando.
// Sem link salvo, mostra o botão de busca no YouTube.
// ---------------------------------------------------------------------------

interface Props {
  videoId?: string
  query: string
  onPlayer: (p: YTPlayer | null) => void
  onState: (s: number) => void
}

export function VideoPanel({ videoId, query, onPlayer, onState }: Props) {
  const [open, setOpen] = useStoredState('musik-video-aberto', true)
  const [error, setError] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef({ onPlayer, onState })
  useEffect(() => {
    cb.current = { onPlayer, onState }
  })

  useEffect(() => {
    if (!videoId || !host.current) return
    let player: YTPlayer | null = null
    let dead = false
    setError('')
    // O player do YouTube troca o elemento por um iframe; usamos um filho descartável.
    const el = document.createElement('div')
    host.current.replaceChildren(el)
    createYouTubePlayer(el, videoId, (s) => cb.current.onState(s))
      .then((p) => {
        if (dead) return p.destroy()
        player = p
        cb.current.onPlayer(p)
      })
      .catch((e: Error) => !dead && setError(`Não consegui carregar o vídeo (${e.message}). As outras fontes de som funcionam sem internet.`))
    return () => {
      dead = true
      cb.current.onPlayer(null)
      player?.destroy()
    }
  }, [videoId])

  if (!videoId) {
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel/80 p-3 text-sm backdrop-blur sm:p-4">
        <span className="text-slate-400">Sem vídeo salvo para esta música.</span>
        <a href={searchUrl.youtube(query)} target="_blank" rel="noopener noreferrer" className="btn btn-round px-4">
          Ver no YouTube ↗
        </a>
      </section>
    )
  }
  return (
    <section className="rounded-2xl border border-line bg-panel/80 p-2 backdrop-blur sm:p-4">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-1 py-1 text-sm font-semibold">
        <span>Vídeo (gravação original)</span>
        <span className="text-slate-400">{open ? '▲ recolher' : '▼ mostrar'}</span>
      </button>
      <div className={open ? 'mt-2' : 'h-0 overflow-hidden'} aria-hidden={!open}>
        <div ref={host} className="aspect-video w-full overflow-hidden rounded-xl bg-black [&_iframe]:h-full [&_iframe]:w-full" />
      </div>
      {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
    </section>
  )
}
