// Links de busca nos sites de música (só abrem a busca; nada é copiado deles).
export const searchUrl = {
  chordify: (q: string) => `https://chordify.net/search/${encodeURIComponent(q)}`,
  songsterr: (q: string) => `https://www.songsterr.com/?pattern=${encodeURIComponent(q)}`,
  cifraclub: (q: string) => `https://www.cifraclub.com.br/?q=${encodeURIComponent(q)}`,
  youtube: (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  ultimateGuitar: (q: string) => `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(q)}`,
}

export const isAndroid = (ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) => /Android/i.test(ua)

/**
 * Link que, no Android, abre o endereço no Chrome. Serve para sites que têm
 * app próprio que "sequestra" os links: com o app do Chordify instalado, o
 * Android manda chordify.net para ele, que não abre a busca e mostra "nenhum
 * navegador compatível". Se o Chrome não existir, vale o endereço normal.
 */
export function chromeIntent(url: string) {
  const u = new URL(url)
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`
}

/** Busca no Chordify: no Android, pelo Chrome (ver chromeIntent); nos outros, o endereço normal. */
export const chordifyHref = (q: string, ua?: string) => (isAndroid(ua) ? chromeIntent(searchUrl.chordify(q)) : searchUrl.chordify(q))

/** Id do vídeo a partir de um link do YouTube (watch, youtu.be, shorts, embed, live). */
export function youtubeId(link: string) {
  const s = link.trim()
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/) ?? s.match(/^([\w-]{11})$/)
  return m?.[1] ?? null
}
