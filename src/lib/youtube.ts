// ---------------------------------------------------------------------------
// Player do YouTube embutido (IFrame Player API oficial). O script do
// YouTube só é baixado quando uma música tem vídeo; sem internet, o app
// avisa e as outras fontes de som continuam funcionando.
// ---------------------------------------------------------------------------

/** Parte da API do player que usamos. */
export interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  setPlaybackRate(rate: number): void
  getPlaybackRate(): number
  cueVideoById(id: string): void
  destroy(): void
}

/** Estados do player (YT.PlayerState). */
export const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string
      playerVars?: Record<string, number | string>
      events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void; onError?: (e: { data: number }) => void }
    },
  ) => YTPlayer
}
type YTWindow = Window & { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void }

let api: Promise<YTNamespace> | null = null

function loadApi(): Promise<YTNamespace> {
  const w = window as YTWindow
  api ??= new Promise<YTNamespace>((resolve, reject) => {
    if (w.YT?.Player) return resolve(w.YT)
    const prev = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve(w.YT!)
    }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.onerror = () => {
      api = null
      s.remove()
      reject(new Error('sem internet'))
    }
    document.head.appendChild(s)
  })
  return api
}

/** Cria o player dentro de `el`. `onState` recebe os estados de YT_STATE. */
export async function createYouTubePlayer(el: HTMLElement, videoId: string, onState: (s: number) => void): Promise<YTPlayer> {
  const YT = await loadApi()
  return new Promise((resolve, reject) => {
    const player = new YT.Player(el, {
      videoId,
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => resolve(player),
        onStateChange: (e) => onState(e.data),
        onError: (e) => reject(new Error(`vídeo indisponível (erro ${e.data})`)),
      },
    })
  })
}
