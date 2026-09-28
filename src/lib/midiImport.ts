import { kvGet, kvSet } from './songDb'
import { normalizeLine, type Song } from './song'

// ---------------------------------------------------------------------------
// Jeitos de trazer o MIDI de acordes para o app (sem entrar no Chordify):
//  - computador: pegar o .mid mais recente da pasta Downloads (File System
//    Access API, Chrome/Edge). A permissão da pasta fica guardada;
//  - celular: "Compartilhar → Acordes" no arquivo baixado. O service worker
//    (public/compartilhar-sw.js) guarda o arquivo e abre o app;
//  - arrastar e soltar, ou o botão "Escolher arquivo" (tratados na tela).
// ---------------------------------------------------------------------------

// Tipos mínimos da File System Access API (ainda fora do TypeScript padrão).
interface DirHandle {
  name: string
  values(): AsyncIterable<{ kind: 'file' | 'directory'; name: string; getFile?: () => Promise<File> }>
  queryPermission(o: { mode: 'read' }): Promise<PermissionState>
  requestPermission(o: { mode: 'read' }): Promise<PermissionState>
}
type PickerWindow = Window & { showDirectoryPicker?: (o: object) => Promise<DirHandle> }

const DIR_KEY = 'pasta-downloads'
const SHARE_CACHE = 'acordes-compartilhados'

export const isMidiName = (name: string) => /\.(mid|midi|kar)$/i.test(name)
/** Tablatura/partitura que o alphaTab lê: Guitar Pro e MusicXML. */
export const isTabName = (name: string) => /\.(gp|gp3|gp4|gp5|gpx|musicxml|mxl)$/i.test(name)
export const canPickFolder = () => typeof (window as PickerWindow).showDirectoryPicker === 'function'

/**
 * O arquivo mais recente da pasta Downloads que seja MIDI de acordes ou
 * tablatura. Na primeira vez o navegador pergunta qual pasta (já abre em
 * Downloads); depois lembra. Precisa ser chamado dentro de um clique.
 */
export async function latestFromDownloads(): Promise<File | null> {
  const w = window as PickerWindow
  let dir = await kvGet<DirHandle>(DIR_KEY).catch(() => undefined)
  if (dir) {
    let perm = await dir.queryPermission({ mode: 'read' })
    if (perm !== 'granted') perm = await dir.requestPermission({ mode: 'read' })
    if (perm !== 'granted') dir = undefined
  }
  if (!dir) {
    dir = await w.showDirectoryPicker!({ id: 'downloads', startIn: 'downloads', mode: 'read' })
    await kvSet(DIR_KEY, dir).catch(() => {})
  }
  let best: File | null = null
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !(isMidiName(entry.name) || isTabName(entry.name)) || !entry.getFile) continue
    const f = await entry.getFile()
    if (!best || f.lastModified > best.lastModified) best = f
  }
  return best
}

/** Arquivos que chegaram pelo "Compartilhar" do celular (e os apaga da fila). */
export async function takeSharedFiles(): Promise<File[]> {
  if (!('caches' in window)) return []
  const cache = await caches.open(SHARE_CACHE)
  const files: File[] = []
  for (const req of await cache.keys()) {
    const res = await cache.match(req)
    if (res) {
      const name = decodeURIComponent(res.headers.get('x-nome') ?? 'compartilhado.mid')
      files.push(new File([await res.blob()], name, { type: res.headers.get('content-type') ?? '' }))
    }
    await cache.delete(req)
  }
  return files
}

// Palavras que não ajudam a achar a música pelo nome do arquivo.
const NOISE = new Set(['chordify', 'chords', 'chord', 'acordes', 'midi', 'mid', 'time', 'aligned', 'official', 'audio', 'video', 'lyrics', 'the', 'a', 'o', 'de', 'feat', 'ft', 'hd', 'remastered', 'live'])
const tokens = (s: string) =>
  normalizeLine(s)
    .split(' ')
    .filter((w) => w.length > 1 && !NOISE.has(w) && !/^\d+$/.test(w))

/** Quanto o nome do arquivo combina com a música (0 a 1). */
export function matchScore(fileName: string, song: Pick<Song, 'title' | 'artist'>) {
  const file = new Set(tokens(fileName.replace(/\.[^.]+$/, '')))
  const title = tokens(song.title)
  if (!title.length || !file.size) return 0
  const hit = title.filter((w) => file.has(w)).length / title.length
  const artist = tokens(song.artist)
  const artistHit = artist.length ? artist.filter((w) => file.has(w)).length / artist.length : 0
  return hit * 0.8 + artistHit * 0.2
}

/** A música da lista que o arquivo parece ser, ou null se nenhuma combina bem. */
export function guessSong<T extends Pick<Song, 'title' | 'artist'>>(fileName: string, songs: T[]): T | null {
  let best: T | null = null
  let score = 0
  for (const s of songs) {
    const sc = matchScore(fileName, s)
    if (sc > score) [best, score] = [s, sc]
  }
  return score >= 0.6 ? best : null
}
