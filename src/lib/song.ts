import type { ChordEvent, ChordTrack } from './chordMidi'
import type { LyricLine } from './lrclib'
import { sameChord, songChordName, type SongChord, type SongKey } from './songChords'

// ---------------------------------------------------------------------------
// Montagem automática da página de karaokê.
//
// Entradas: a letra (com o tempo de cada linha, do LRCLIB), os acordes com
// início e fim (do MIDI ou de outra fonte) e as batidas. Saída ("folha"):
//
//   música → seções → linhas da letra → compassos → acordes + trecho da letra
//
// Passos:
//  1. As batidas são agrupadas em compassos (4 no 4/4, 3 no 3/4...).
//  2. Cada compasso recebe o acorde que soa no 1º tempo e os que entram depois,
//     cada um no tempo em que entra.
//  3. Cada linha da letra começa no compasso onde é cantada; as palavras são
//     espalhadas pelo tempo estimado de canto da linha (pelas sílabas).
//  4. Trechos longos sem letra viram blocos INTRO (começo), SOLO (meio) e
//     FINAL (fim). Por enquanto só o rótulo aparece; os compassos desses
//     trechos ficam guardados em `measures` para serem usados no futuro.
//  5. Estrofes são separadas por linhas vazias, trechos instrumentais ou
//     pausas; linhas que se repetem na música viram "Refrão".
// ---------------------------------------------------------------------------

export type ChordSource = 'midi' | 'audio' | 'mic' | 'manual' | 'tap'

export const METERS = ['4/4', '3/4', '6/8'] as const
export type Meter = (typeof METERS)[number]
export const meterBeats = (m: Meter) => Number(m.split('/')[0])
export const BPM_RANGE = { min: 30, max: 250 }

export interface MeasureChord {
  beat: number // tempo do compasso em que o acorde entra (0 = 1º tempo)
  chord: SongChord | null
}

export interface Song {
  id: string
  title: string
  artist: string
  album: string
  duration: number // duração da gravação da letra escolhida (s)
  lrclibId?: number
  lyrics: LyricLine[]
  synced: boolean
  youtube?: string
  capo: number
  source: ChordSource | null
  midi?: ArrayBuffer
  midiName?: string
  track?: ChordTrack
  lyricOffset: number // ajuste fino da letra (s): + atrasa, − adianta
  lyricScale?: number // correção de velocidade da letra (versões com andamento diferente); 1 = igual
  downbeatShift: number // desloca o 1º tempo do compasso (em batidas)
  measureEdits: Record<number, MeasureChord[]> // correções feitas em "Editar compassos"
  bpmOverride?: number // BPM digitado/batido (senão, o do MIDI)
  meter?: Meter // compasso escolhido (senão, o do MIDI)
  countIn?: number // contagem de entrada, em batidas (0 = sem)
  autoTrack?: ChordTrack // marcação automática guardada quando você "marca o tempo"
  sheet?: Sheet
  createdAt: number
  updatedAt: number
}

export interface Measure {
  index: number
  start: number
  end: number
  beats: number[] // instante de cada tempo
  chords: MeasureChord[]
  lyric: string
  edited: boolean
}

export interface SheetLine {
  text: string
  start: number
  measures: Measure[]
}

export type SectionKind = 'verso' | 'refrao' | 'intro' | 'solo' | 'final'

export interface Section {
  kind: SectionKind
  label: string
  start: number
  end: number
  lines: SheetLine[] // vazio nos trechos instrumentais
  /** Trechos instrumentais: compassos guardados para o futuro (ainda não mostrados). */
  measures: Measure[]
  /** Reservado para o conteúdo do INTRO/SOLO/FINAL (tablatura, riff...). */
  content: null
}

export interface Sheet {
  sections: Section[]
  measures: Measure[] // todos os compassos, na ordem
  chordsInOrder: SongChord[] // acordes usados, sem repetição, na ordem em que aparecem
  beatsPerBar: number
  bpm: number
  key: SongKey | null
  warnings: string[]
}

export const DEFAULT_BPM = 90
/** Tempo médio de canto por sílaba (s), para espalhar as palavras pela linha. */
const SYLLABLE_S = 0.3
/** Trecho sem letra no começo/fim com pelo menos isto vira INTRO/FINAL. */
const EDGE_MIN = { measures: 2, seconds: 5 }
/** Trecho sem letra no meio com pelo menos isto vira SOLO. */
const SOLO_MIN = { measures: 4, seconds: 8 }
/** Diferença de duração entre letra e MIDI que gera o aviso (s). */
const DURATION_WARN_S = 10
/** Linha cuja voz entra depois desta fração do compasso começa no compasso seguinte. */
const PICKUP_FRACTION = 0.5

export function newSong(p: Pick<Song, 'id' | 'title' | 'artist' | 'album' | 'duration' | 'lyrics' | 'synced'> & { lrclibId?: number }): Song {
  const now = Date.now()
  return { capo: 0, source: null, lyricOffset: 0, downbeatShift: 0, measureEdits: {}, createdAt: now, updatedAt: now, ...p }
}

// ---------------------------------------------------------------------------

function buildMeasures(song: Song): { measures: Measure[]; beatsPerBar: number; bpm: number } {
  const t = song.track
  const beatsPerBar = song.meter ? meterBeats(song.meter) : (t?.beatsPerBar ?? 4)
  const bpm = song.bpmOverride ?? t?.bpm ?? DEFAULT_BPM
  let beats = t?.beats ?? []
  if (!beats.length) {
    // Sem acordes ainda: uma grade no BPM padrão, só para os blocos existirem.
    const end = Math.max(song.duration, ...song.lyrics.map((l) => (l.t ?? 0) + 5), 30)
    beats = Array.from({ length: Math.ceil((end * bpm) / 60) + 1 }, (_, i) => (i * 60) / bpm)
  }
  const beatLen = beats.length > 1 ? beats[1] - beats[0] : 60 / bpm
  const shift = ((((t?.downbeat ?? 0) + song.downbeatShift) % beatsPerBar) + beatsPerBar) % beatsPerBar
  const starts: number[] = shift ? [0] : [] // anacruse: compasso incompleto antes do 1º tempo
  for (let i = shift; i < beats.length; i += beatsPerBar) starts.push(i)

  const events = tidyEvents(t?.chords ?? [])
  const measures = starts.map((b0, index): Measure => {
    const b1 = index + 1 < starts.length ? starts[index + 1] : Math.min(beats.length, b0 + beatsPerBar)
    const mb = beats.slice(b0, b1)
    const start = mb[0]
    const end = beats[b1] ?? start + beatLen * beatsPerBar
    const edit = song.measureEdits[index]
    return {
      index,
      start,
      end,
      beats: mb,
      chords: edit ?? chordsIn(events, mb, end),
      lyric: '',
      edited: !!edit,
    }
  })
  return { measures, beatsPerBar, bpm }
}

// Acorde no 1º tempo + os que entram depois, cada um no tempo mais próximo.
function chordsIn(events: ChordEvent[], beats: number[], end: number): MeasureChord[] {
  if (!events.length || !beats.length) return []
  const beatLen = beats.length > 1 ? beats[1] - beats[0] : end - beats[0]
  const tol = Math.min(0.12, beatLen * 0.3)
  const out: MeasureChord[] = []
  const atStart = events.find((e) => e.start <= beats[0] + tol && e.end > beats[0] + tol)
  if (atStart) out.push({ beat: 0, chord: atStart.chord })
  for (const e of events) {
    if (e.start <= beats[0] + tol || e.start >= end - tol) continue
    let beat = 0
    beats.forEach((b, i) => {
      if (Math.abs(b - e.start) < Math.abs(beats[beat] - e.start)) beat = i
    })
    if (beat === 0) continue
    const same = out.find((c) => c.beat === beat)
    if (same) same.chord = e.chord
    else out.push({ beat, chord: e.chord })
  }
  // Tira repetições seguidas (o mesmo acorde "reentrando" no compasso).
  out.sort((a, b) => a.beat - b.beat)
  return out.filter((c, i) => i === 0 || !sameChord(c.chord, out[i - 1].chord))
}

/** Silêncio mais curto que isto (s) entre acordes não é "sem acorde": o acorde anterior continua. */
const SHORT_GAP_S = 1

/**
 * Arruma a marcação antes de dividir em compassos: muitos MIDIs tocam o
 * acorde curtinho em cada tempo, com silêncio entre os toques. Esses
 * silêncios curtos são juntados ao acorde anterior e o mesmo acorde seguido
 * vira um só, para não aparecer "G — G —" dentro do compasso.
 */
export function tidyEvents(events: ChordEvent[]): ChordEvent[] {
  const out: ChordEvent[] = []
  for (const e of events) {
    const last = out[out.length - 1]
    if (last && !e.chord && e.end - e.start < SHORT_GAP_S) last.end = e.end
    else if (last && sameChord(last.chord, e.chord)) last.end = e.end
    else out.push({ ...e })
  }
  return out
}

const syllables = (word: string) => Math.max(1, (word.toLowerCase().match(/[aeiouyáéíóúâêôãõàü]+/g) ?? []).length)

export const normalizeLine = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Tempo de uma linha da letra (LRCLIB) já no relógio dos acordes: escala e ajuste fino. */
export const lyricTime = (song: Pick<Song, 'lyricOffset' | 'lyricScale'>, t: number) => t * (song.lyricScale ?? 1) + song.lyricOffset

/**
 * "Acertar a letra pela voz": cada par é o tempo da linha na letra (LRC) e o
 * instante (na gravação) em que você ouviu a voz começar essa linha.
 * Com um par, só desloca a letra; com pares espalhados pela música (20 s ou
 * mais entre eles), também corrige uma pequena diferença de velocidade.
 */
export function fitLyricSync(pairs: { lrc: number; heard: number }[]): { offset: number; scale: number } {
  const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d
  if (!pairs.length) return { offset: 0, scale: 1 }
  const lrcs = pairs.map((p) => p.lrc)
  // Só deslocar: a mediana das diferenças (um toque errado não estraga).
  const shiftOnly = () => {
    const diffs = pairs.map((p) => p.heard - p.lrc).sort((a, b) => a - b)
    return { offset: round(diffs[Math.floor(diffs.length / 2)], 2), scale: 1 }
  }
  if (pairs.length < 2 || Math.max(...lrcs) - Math.min(...lrcs) < 20) return shiftOnly()
  // Reta que melhor passa pelos pontos (mínimos quadrados): ouvido = escala × lrc + deslocamento.
  const n = pairs.length
  const mx = lrcs.reduce((a, b) => a + b, 0) / n
  const my = pairs.reduce((a, p) => a + p.heard, 0) / n
  const sxy = pairs.reduce((a, p) => a + (p.lrc - mx) * (p.heard - my), 0)
  const sxx = pairs.reduce((a, p) => a + (p.lrc - mx) ** 2, 0)
  const scale = sxy / sxx
  // Diferença de velocidade grande demais é engano de toque: fica só o deslocamento.
  if (!(scale > 0.9 && scale < 1.1)) return shiftOnly()
  return { offset: round(my - scale * mx, 2), scale: round(scale, 4) }
}

interface TimedLine {
  text: string
  t: number
  breakBefore: boolean
}

// Letra sem tempo: espalhamos as linhas pelos compassos que têm acorde.
function timeLines(song: Song, measures: Measure[]): TimedLine[] {
  const out: TimedLine[] = []
  let pendingBreak = false
  if (song.synced) {
    for (const l of song.lyrics) {
      if (!l.text) {
        pendingBreak = true
        continue
      }
      out.push({ text: l.text, t: lyricTime(song, l.t ?? 0), breakBefore: pendingBreak })
      pendingBreak = false
    }
    return out
  }
  const withChords = measures.filter((m) => m.chords.some((c) => c.chord))
  const pool = withChords.length ? withChords : measures
  const texts = song.lyrics.filter((l) => l.text)
  let k = 0
  for (const l of song.lyrics) {
    if (!l.text) {
      pendingBreak = true
      continue
    }
    const m = pool[Math.floor((k++ * pool.length) / texts.length)]
    out.push({ text: l.text, t: (m?.start ?? 0) + song.lyricOffset, breakBefore: pendingBreak })
    pendingBreak = false
  }
  return out
}

export function assemble(song: Song): Sheet {
  const { measures, beatsPerBar, bpm } = buildMeasures(song)
  const warnings: string[] = []
  const hasChord = (m: Measure) => m.chords.some((c) => c.chord)
  const measureAt = (t: number) => {
    let i = measures.findIndex((m) => t < m.end)
    if (i < 0) i = measures.length - 1
    return Math.max(0, i)
  }

  // --- linhas da letra -> compassos ----------------------------------------
  const lines = timeLines(song, measures)
  type Placed = TimedLine & { first: number; lastSung: number; words: { w: string; t: number }[] }
  const placed: Placed[] = []
  lines.forEach((l, i) => {
    let first = measureAt(l.t)
    const m = measures[first]
    // Voz que entra na 2ª metade do compasso (anacruse): a linha começa no
    // compasso seguinte, para o bloco não acender muito antes de a voz entrar.
    if (m && l.t > m.start + (m.end - m.start) * PICKUP_FRACTION && first + 1 < measures.length) first++
    const nextT = lines[i + 1]?.t ?? Infinity
    const words = l.text.split(/\s+/).filter(Boolean)
    const total = words.reduce((a, w) => a + syllables(w), 0)
    const dur = Math.max(0.8, Math.min(total * SYLLABLE_S, nextT - l.t - 0.05))
    let acc = 0
    const timed = words.map((w) => {
      const t = l.t + (dur * acc) / total
      acc += syllables(w)
      return { w, t }
    })
    const prev = placed[placed.length - 1]
    if (prev && first <= prev.first) {
      // Duas linhas no mesmo compasso: viram uma linha só.
      prev.text += ' ' + l.text
      prev.words.push(...timed)
      prev.lastSung = Math.max(prev.lastSung, measureAt(l.t + dur))
      return
    }
    placed.push({ ...l, first, lastSung: Math.max(first, measureAt(l.t + dur)), words: timed })
  })

  const firstChordM = measures.findIndex(hasChord)
  const lastChordM = measures.length - 1 - [...measures].reverse().findIndex(hasChord)
  const songStart = firstChordM >= 0 ? firstChordM : 0
  const songEnd = firstChordM >= 0 ? lastChordM : measures.length - 1
  const span = (a: number, b: number) => ({ n: b - a, s: (measures[b - 1]?.end ?? 0) - (measures[a]?.start ?? 0) })
  const isLong = (a: number, b: number, min: { measures: number; seconds: number }) =>
    span(a, b).n >= min.measures && span(a, b).s >= min.seconds

  const sections: Section[] = []
  const instrumental = (kind: 'intro' | 'solo' | 'final', a: number, b: number): Section => ({
    kind,
    label: { intro: 'INTRO', solo: 'SOLO', final: 'FINAL' }[kind],
    start: measures[a].start,
    end: measures[b - 1].end,
    lines: [],
    measures: measures.slice(a, b),
    content: null,
  })

  // Sem letra: tudo vira uma seção só com os compassos em linhas de 4.
  if (!placed.length) {
    const ms = measures.slice(songStart, songEnd + 1)
    const chunk: SheetLine[] = []
    for (let i = 0; i < ms.length; i += 4) chunk.push({ text: '', start: ms[i].start, measures: ms.slice(i, i + 4) })
    if (chunk.length) sections.push({ kind: 'verso', label: 'Acordes', start: chunk[0].start, end: ms[ms.length - 1].end, lines: chunk, measures: [], content: null })
    return finish()
  }

  // Blocos de cada linha (de "first" até antes da próxima linha), tirando
  // os trechos longos sem letra, que viram SOLO.
  type Built = { line: SheetLine; breakBefore: boolean; soloBefore?: Section }
  const built: Built[] = []
  let introEnd = placed[0].first
  let lead: Measure[] = []
  if (placed[0].first > songStart) {
    if (isLong(songStart, placed[0].first, EDGE_MIN)) sections.push(instrumental('intro', songStart, placed[0].first))
    else {
      lead = measures.slice(songStart, placed[0].first)
      introEnd = songStart
    }
  }
  placed.forEach((p, i) => {
    const nextFirst = placed[i + 1]?.first ?? songEnd + 1
    const sungEnd = Math.min(p.lastSung + 1, nextFirst)
    let end = nextFirst
    let solo: Section | undefined
    let gapBreak = false
    const isLast = i === placed.length - 1
    if (isLast) {
      if (sungEnd <= songEnd && isLong(sungEnd, songEnd + 1, EDGE_MIN)) {
        end = sungEnd
        solo = instrumental('final', sungEnd, songEnd + 1)
      } else end = Math.max(sungEnd, songEnd + 1)
    } else if (isLong(sungEnd, nextFirst, SOLO_MIN)) {
      end = sungEnd
      solo = instrumental('solo', sungEnd, nextFirst)
    } else if (nextFirst - sungEnd >= 2) gapBreak = true
    const ms = [...(i === 0 ? lead : []), ...measures.slice(i === 0 ? Math.max(p.first, introEnd) : p.first, end)]
    for (const m of ms) m.lyric = ''
    for (const w of p.words) {
      const target = ms.find((m) => w.t < m.end) ?? ms[ms.length - 1]
      const m = w.t < (ms[0]?.start ?? 0) ? ms.find((x) => x.index >= p.first) ?? ms[0] : target
      if (m) m.lyric = m.lyric ? `${m.lyric} ${w.w}` : w.w
    }
    built.push({ line: { text: p.text, start: p.t, measures: ms }, breakBefore: p.breakBefore || i === 0 })
    if (solo) built.push({ line: null as never, breakBefore: true, soloBefore: solo })
    if (gapBreak && placed[i + 1]) placed[i + 1].breakBefore = true
  })

  // --- estrofes e rótulos ---------------------------------------------------
  const count = new Map<string, number>()
  for (const b of built) if (b.line) count.set(normalizeLine(b.line.text), (count.get(normalizeLine(b.line.text)) ?? 0) + 1)
  const repeated = (l: SheetLine) => normalizeLine(l.text).length >= 3 && (count.get(normalizeLine(l.text)) ?? 0) >= 2

  let stanza: SheetLine[] = []
  let verse = 0
  const flush = () => {
    if (!stanza.length) return
    // Dentro da estrofe: trechos de 2+ linhas repetidas viram refrão.
    const runs: { rep: boolean; lines: SheetLine[] }[] = []
    for (const l of stanza) {
      const rep = repeated(l)
      const last = runs[runs.length - 1]
      if (last && last.rep === rep) last.lines.push(l)
      else runs.push({ rep, lines: [l] })
    }
    const merged = runs.reduce<typeof runs>((out, r) => {
      const prev = out[out.length - 1]
      if (prev && (r.lines.length < 2 || prev.lines.length < 2)) {
        prev.lines.push(...r.lines)
        prev.rep = prev.rep && r.rep ? true : prev.lines.filter(repeated).length > prev.lines.length / 2
      } else out.push({ ...r, lines: [...r.lines] })
      return out
    }, [])
    for (const r of merged) {
      const lastM = r.lines[r.lines.length - 1].measures
      sections.push({
        kind: r.rep ? 'refrao' : 'verso',
        label: r.rep ? 'Refrão' : `Verso ${++verse}`,
        start: r.lines[0].measures[0]?.start ?? r.lines[0].start,
        end: lastM[lastM.length - 1]?.end ?? r.lines[0].start,
        lines: r.lines,
        measures: [],
        content: null,
      })
    }
    stanza = []
  }
  for (const b of built) {
    if (b.soloBefore) {
      flush()
      sections.push(b.soloBefore)
      continue
    }
    if (b.breakBefore) flush()
    stanza.push(b.line)
  }
  flush()
  return finish()

  function finish(): Sheet {
    const seen = new Map<string, SongChord>()
    for (const m of measures) for (const c of m.chords) if (c.chord && !seen.has(songChordName(c.chord))) seen.set(songChordName(c.chord), c.chord)
    const t = song.track
    if (t && song.duration && Math.abs(t.duration - song.duration) > DURATION_WARN_S) {
      warnings.push(
        `A letra escolhida dura ${fmt(song.duration)} e os acordes ${fmt(t.duration)}: provavelmente são versões diferentes da música (ex.: o vídeo tem introdução mais longa), e a letra fica fora de tempo. Escolha uma letra com a duração dos acordes ou use "Acertar a letra pela voz" em Tempo e sincronia.`,
      )
    }
    return { sections, measures, chordsInOrder: [...seen.values()], beatsPerBar, bpm, key: t?.key ?? null, warnings }
  }
}

/** A sequência de trocas de acorde da folha (sem repetir o mesmo acorde seguido). */
export function chordChanges(sheet: Sheet): SongChord[] {
  const out: SongChord[] = []
  for (const m of sheet.measures)
    for (const c of m.chords) if (c.chord && !sameChord(c.chord, out[out.length - 1])) out.push(c.chord)
  return out
}

/**
 * Modo "marcar tempo": cada toque é o instante (na gravação) de uma troca de
 * acorde, na ordem de `changes`. Monta uma nova marcação de acordes com esses
 * instantes. As batidas continuam as do MIDI, se houver; senão, uma grade no
 * BPM da música começando no 1º toque (que costuma cair num 1º tempo).
 */
export function trackFromTaps(song: Song, sheet: Sheet, taps: number[], changes: SongChord[]): ChordTrack {
  const base = song.autoTrack ?? song.track
  const bpm = sheet.bpm
  const spb = 60 / bpm
  const chords: ChordEvent[] = taps.map((t, i) => ({
    start: t,
    end: taps[i + 1] ?? t + spb * sheet.beatsPerBar,
    chord: changes[i] ?? null,
  }))
  let beats = base?.beats ?? []
  let downbeat = base?.downbeat ?? 0
  if (!beats.length && taps.length) {
    const end = Math.max(song.duration, chords[chords.length - 1].end) + spb
    const first = taps[0] - Math.floor(taps[0] / spb) * spb
    beats = Array.from({ length: Math.ceil((end - first) / spb) + 1 }, (_, i) => first + i * spb)
    downbeat = Math.round((taps[0] - first) / spb) % sheet.beatsPerBar
  }
  return {
    chords,
    beats,
    beatsPerBar: base?.beatsPerBar ?? sheet.beatsPerBar,
    beatUnit: base?.beatUnit ?? 4,
    bpm: base?.bpm ?? bpm,
    key: base?.key ?? { tonic: 'C', minor: false, flats: false, name: '—' },
    duration: chords[chords.length - 1]?.end ?? 0,
    downbeat,
  }
}

/** O próximo acorde diferente do que soa em (compasso, tempo): o "a seguir" do karaokê. */
export function nextChord(sheet: Sheet, measure: number, beat: number): SongChord | null {
  const current = chordAt(sheet.measures[measure], beat)
  for (let i = measure; i < sheet.measures.length; i++)
    for (const c of sheet.measures[i].chords) {
      if (i === measure && c.beat <= beat) continue
      if (c.chord && !sameChord(c.chord, current)) return c.chord
    }
  return null
}

/** O acorde diferente que tocou antes do que soa em (compasso, tempo). */
export function prevChord(sheet: Sheet, measure: number, beat: number): SongChord | null {
  const current = chordAt(sheet.measures[measure], beat)
  for (let i = measure; i >= 0; i--) {
    const cs = sheet.measures[i]?.chords ?? []
    for (let k = cs.length - 1; k >= 0; k--) {
      if (i === measure && cs[k].beat > beat) continue
      if (cs[k].chord && !sameChord(cs[k].chord, current)) return cs[k].chord
    }
  }
  return null
}

/** Acorde soando num tempo do compasso. */
export function chordAt(m: Measure | undefined, beat: number): SongChord | null {
  if (!m) return null
  let c: SongChord | null = null
  for (const mc of m.chords) if (mc.beat <= beat) c = mc.chord
  return c
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
