import { Note } from 'tonal'
import { findDownbeat, type ChordEvent, type ChordTrack } from './chordMidi'
import { lyricTime, normalizeLine, type Song } from './song'
import { estimateKey, parseSongChord, type SongChord } from './songChords'

// ---------------------------------------------------------------------------
// Cifra colada à mão (último recurso quando não há MIDI nem áudio).
// Aceita os dois formatos mais comuns:
//
//   acorde sobre a letra:          ChordPro:
//     G        Em                    [G]era uma vez [Em]outra
//     era uma vez outra
//
// Linhas só com acordes (intro, passagens) viram um acorde por compasso.
// Títulos como "Refrão:" ou "[Intro]" e tablaturas são ignorados.
// ---------------------------------------------------------------------------

export interface PastedLine {
  lyric: string // "" = linha só de acordes
  chords: { pos: number; chord: SongChord }[] // pos = coluna na letra
}

// Coisas que aparecem nas linhas de acordes e não são acordes.
const IGNORABLE = /^(\||\|\||-+|\/|x\d+|\d+x|\(\d*x\d*\)|intro:?|solo:?|final:?|refr[aã]o:?|riff:?|\.+)$/i
const HEADER = /^\s*(\[[^\]]*\]|\(?(intro|introdu[cç][aã]o|refr[aã]o|verso|estrofe|ponte|pr[eé]-?refr[aã]o|solo|final|primeira parte|segunda parte|parte \d+)\b[^a-z]*\)?:?)\s*$/i
const TAB = /^\s*[eEADGBb]\s*\|[-\d|hpbr/\\~x ]*$|---/

function chordToken(tok: string): SongChord | null {
  const t = tok.replace(/^\((.+)\)$/, '$1')
  return /^[A-Ga-g]/.test(t) ? parseSongChord(t) : null
}

/** Linha de acordes: pelo menos 60% dos "pedaços" (sem contar barras, x2...) são acordes. */
function chordLine(line: string): PastedLine['chords'] | null {
  const toks = [...line.matchAll(/\S+/g)]
  const real = toks.filter((m) => !IGNORABLE.test(m[0]))
  const found = real.flatMap((m) => {
    const c = chordToken(m[0])
    return c ? [{ pos: m.index!, chord: c }] : []
  })
  return found.length && found.length >= real.length * 0.6 ? found : null
}

export function parsePastedChords(text: string): PastedLine[] {
  const rows = text.replace(/\t/g, '    ').split(/\r?\n/)
  const out: PastedLine[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].replace(/\s+$/, '')
    if (!row.trim() || TAB.test(row)) continue
    // ChordPro: [G]palavra
    if (/\[[^\]]+\]/.test(row) && !HEADER.test(row)) {
      const chords: PastedLine['chords'] = []
      let lyric = ''
      let last = 0
      for (const m of row.matchAll(/\[([^\]]+)\]/g)) {
        lyric += row.slice(last, m.index)
        last = m.index! + m[0].length
        const c = chordToken(m[1].trim())
        if (c) chords.push({ pos: lyric.length, chord: c })
      }
      lyric += row.slice(last)
      if (chords.length || lyric.trim()) out.push({ lyric: lyric.trim() ? lyric : '', chords })
      continue
    }
    if (HEADER.test(row)) continue
    const chords = chordLine(row)
    if (chords) {
      const next = rows[i + 1]?.replace(/\s+$/, '') ?? ''
      if (next.trim() && !chordLine(next) && !HEADER.test(next) && !TAB.test(next) && !/\[[^\]]+\]/.test(next)) {
        out.push({ lyric: next, chords })
        i++
      } else out.push({ lyric: '', chords })
      continue
    }
    out.push({ lyric: row, chords: [] }) // letra sem acorde em cima
  }
  return out
}

const words = (s: string) => new Set(normalizeLine(s).split(' ').filter(Boolean))
function similar(a: string, b: string) {
  const A = words(a)
  const B = words(b)
  if (!A.size || !B.size) return 0
  let n = 0
  for (const w of A) if (B.has(w)) n++
  return n / Math.max(A.size, B.size)
}
const syllables = (s: string) => Math.max(1, (s.toLowerCase().match(/[aeiouyáéíóúâêôãõàü]+/g) ?? []).length)

/**
 * Monta a marcação de acordes a partir da cifra colada. Se a letra da música
 * tem tempo (LRCLIB), cada linha colada é casada com a linha parecida da
 * letra e os acordes caem na posição da sílaba; senão, cada linha dura 2
 * compassos no BPM da música. Linhas só de acordes: 1 acorde por compasso.
 */
export function trackFromPaste(song: Song, pasted: PastedLine[], bpm: number, beatsPerBar: number): ChordTrack {
  const spb = 60 / bpm
  const bar = spb * beatsPerBar
  const timed = song.synced ? song.lyrics.filter((l) => l.text && l.t !== null).map((l) => ({ t: lyricTime(song, l.t!), text: l.text })) : []
  const events: { t: number; chord: SongChord }[] = []
  let T = 0
  let j = 0
  for (const p of pasted) {
    if (!p.lyric.trim()) {
      for (const c of p.chords) {
        events.push({ t: T, chord: c.chord })
        T += bar
      }
      continue
    }
    // Procura a linha da letra (com tempo) mais parecida, logo adiante.
    let k = -1
    let best = 0.5
    for (let x = j; x < Math.min(timed.length, j + 8); x++) {
      const s = similar(p.lyric, timed[x].text)
      if (s >= best) [k, best] = [x, s]
    }
    const start = k >= 0 ? timed[k].t : T
    const next = k >= 0 && timed[k + 1] ? timed[k + 1].t : start + 2 * bar
    if (k >= 0) j = k + 1
    const len = Math.max(1, p.lyric.trimEnd().length)
    const sung = Math.min(next - start, Math.max(bar, syllables(p.lyric) * 0.3))
    // Acordes no fim da linha (depois da letra) caem depois do trecho cantado.
    for (const c of p.chords) events.push({ t: c.pos >= len ? start + sung : start + (c.pos / len) * sung, chord: c.chord })
    T = Math.max(next, start + (p.chords.some((c) => c.pos >= len) ? sung + spb : 0))
  }
  // Em ordem e sem repetir o mesmo acorde seguido.
  events.sort((a, b) => a.t - b.t)
  const chords: ChordEvent[] = []
  for (const e of events) {
    const last = chords[chords.length - 1]
    if (last && Math.abs(last.start - e.t) < 0.05) last.chord = e.chord
    else chords.push({ start: e.t, end: e.t + bar, chord: e.chord })
  }
  chords.forEach((c, i) => (c.end = chords[i + 1]?.start ?? c.start + bar))

  // Grade de batidas no BPM, com o 1º acorde num 1º tempo.
  const first = chords[0]?.start ?? 0
  const t0 = first - Math.floor(first / spb) * spb
  const end = Math.max(song.duration, chords[chords.length - 1]?.end ?? 0) + bar
  const beats = Array.from({ length: Math.ceil((end - t0) / spb) + 1 }, (_, i) => t0 + i * spb)
  const ids = chords.map((c) => ({ rootPc: Note.chroma(c.chord!.root) ?? 0, q: c.chord!.q, dur: c.end - c.start }))
  return {
    chords,
    beats,
    beatsPerBar,
    beatUnit: 4,
    bpm,
    key: estimateKey(ids),
    duration: chords[chords.length - 1]?.end ?? 0,
    downbeat: findDownbeat(chords, beats, beatsPerBar),
  }
}
