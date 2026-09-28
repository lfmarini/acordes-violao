// Links de busca nos sites de música (só abrem a busca; nada é copiado deles).
export const searchUrl = {
  chordify: (q: string) => `https://chordify.net/search/${encodeURIComponent(q)}`,
  songsterr: (q: string) => `https://www.songsterr.com/?pattern=${encodeURIComponent(q)}`,
  cifraclub: (q: string) => `https://www.cifraclub.com.br/?q=${encodeURIComponent(q)}`,
  youtube: (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  ultimateGuitar: (q: string) => `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(q)}`,
}

/** Id do vídeo a partir de um link do YouTube (watch, youtu.be, shorts, embed, live). */
export function youtubeId(link: string) {
  const s = link.trim()
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/) ?? s.match(/^([\w-]{11})$/)
  return m?.[1] ?? null
}
