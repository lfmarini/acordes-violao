// ---------------------------------------------------------------------------
// Busca de letras no LRCLIB (lrclib.net): gratuito, sem chave.
// A documentação pede para o app se identificar. O navegador não deixa
// trocar o "User-Agent", então usamos o cabeçalho "Lrclib-Client", que o
// próprio LRCLIB aceita para esse fim (está liberado no CORS do servidor).
// ---------------------------------------------------------------------------

const API = 'https://lrclib.net/api'
export const CLIENT_ID = 'AcordesViolao/1.0 (https://acordes-violao.vercel.app)'

export interface LrclibTrack {
  id: number
  trackName: string
  artistName: string
  albumName: string | null
  duration: number // segundos
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

export interface LyricLine {
  t: number | null // segundos desde o início da gravação (null = letra sem tempo)
  text: string // "" = linha vazia (costuma separar estrofes)
}

export async function searchLrclib(query: string, signal?: AbortSignal): Promise<LrclibTrack[]> {
  const res = await fetch(`${API}/search?q=${encodeURIComponent(query.trim())}`, {
    headers: { 'Lrclib-Client': CLIENT_ID },
    signal,
  })
  if (!res.ok) throw new Error(`O LRCLIB respondeu com erro ${res.status}.`)
  return (await res.json()) as LrclibTrack[]
}

/** Formato LRC: "[01:23.45] texto". Uma linha pode ter vários tempos. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const row of lrc.split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d+):(\d+(?:[.,]\d+)?)\]/g)]
    if (!stamps.length) continue // cabeçalhos como [ar:...] ou linhas soltas
    const text = row.replace(/\[[^\]]*\]/g, '').trim()
    for (const s of stamps) out.push({ t: Number(s[1]) * 60 + Number(s[2].replace(',', '.')), text })
  }
  return out.sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
}

export function plainLines(text: string): LyricLine[] {
  return text.split(/\r?\n/).map((l) => ({ t: null, text: l.trim() }))
}

export const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
