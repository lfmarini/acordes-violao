import * as alphaTab from '@coderline/alphatab'
import type { Section, Sheet } from './song'

// ---------------------------------------------------------------------------
// Tablatura / partitura dos trechos INTRO, SOLO e FINAL, a partir de um
// arquivo Guitar Pro (.gp, .gp5, .gpx...) ou MusicXML, lido pelo alphaTab
// (licença MPL-2.0). Tudo automático:
//  - escolhe a faixa de guitarra que mais toca nesses trechos;
//  - acha o compasso da tablatura onde cada trecho começa: pelas marcações
//    do arquivo ("Intro", "Solo", "Outro"...) ou, sem elas, contando os
//    compassos a partir do começo da música;
//  - você pode corrigir com ◀ ▶ (deslocamento guardado por trecho).
// Este módulo é carregado só quando uma música tem tablatura (é grande).
// ---------------------------------------------------------------------------

export type Score = alphaTab.model.Score

export function loadTab(bytes: ArrayBuffer | Uint8Array): Score {
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), new alphaTab.Settings())
}

// Lê o arquivo uma vez só por música (vários trechos usam a mesma partitura).
const cache = new WeakMap<ArrayBuffer, Score>()
export function scoreFor(tab: { bytes: ArrayBuffer }): Score {
  let s = cache.get(tab.bytes)
  if (!s) {
    s = loadTab(tab.bytes)
    cache.set(tab.bytes, s)
  }
  return s
}

export type TabViewMode = 'tab' | 'partitura' | 'ambas'

/**
 * Desenha só os compassos de um trecho, na faixa escolhida, com as cores do
 * tema do app. Sem som (o som vem do vídeo ou do acompanhamento do karaokê)
 * e sem "workers", para funcionar igual em qualquer navegador e offline.
 */
export function renderSection(
  el: HTMLElement,
  score: Score,
  o: { track: number; startBar: number; barCount: number; view: TabViewMode; colors: { text: string; sub: string; line: string } },
) {
  const s = new alphaTab.Settings()
  s.core.useWorkers = false
  s.core.enableLazyLoading = false
  s.core.fontDirectory = '/alphatab/font/'
  s.player.enablePlayer = false
  s.display.startBar = o.startBar + 1 // o alphaTab conta a partir de 1
  s.display.barCount = o.barCount
  // Menor no celular, para caber mais compassos por linha.
  s.display.scale = el.clientWidth < 500 ? 0.7 : 0.85
  // Sem cabeçalho (título, artista, afinação, nome da faixa): a página já mostra isso.
  const E = alphaTab.NotationElement
  for (const k of [E.ScoreTitle, E.ScoreSubTitle, E.ScoreArtist, E.ScoreAlbum, E.ScoreWords, E.ScoreMusic, E.ScoreWordsAndMusic, E.ScoreCopyright, E.GuitarTuning, E.TrackNames])
    s.notation.elements.set(k, false)
  s.display.staveProfile = { tab: alphaTab.StaveProfile.Tab, partitura: alphaTab.StaveProfile.Score, ambas: alphaTab.StaveProfile.Default }[o.view]
  const c = (hex: string) => alphaTab.model.Color.fromJson(hex)!
  const r = s.display.resources
  r.mainGlyphColor = c(o.colors.text)
  r.secondaryGlyphColor = c(o.colors.sub)
  r.scoreInfoColor = c(o.colors.text)
  r.staffLineColor = c(o.colors.line)
  r.barSeparatorColor = c(o.colors.sub)
  r.barNumberColor = c(o.colors.sub)
  const api = new alphaTab.AlphaTabApi(el, s)
  api.renderScore(score, [o.track])
  return api
}

export type TabApi = ReturnType<typeof renderSection>

/** Trecho da música ligado a um pedaço da tablatura. */
export interface TabSection {
  key: string // "solo-1", "intro-1"...
  label: string
  measures: number[] // compassos da música (índices da folha)
  startBar: number // 1º compasso da tablatura (0 = primeiro)
  barCount: number
  how: 'marcação' | 'contagem'
  marker?: string // texto da marcação usada
}

// Nomes que os arquivos costumam dar a cada tipo de trecho (português e inglês).
const MARKER: Record<'intro' | 'solo' | 'final', RegExp> = {
  intro: /intro/i,
  solo: /solo|interl|instrumental|ponte|bridge|riff|break/i,
  final: /outro|final|fim|ending|coda/i,
}

const firstMeasureOf = (s: Section) => (s.lines.length ? s.lines[0].measures[0]?.index : s.measures[0]?.index) ?? 0

/** Trechos sem letra da música, cada um com o pedaço correspondente da tablatura. */
export function mapSections(score: Score, sheet: Sheet, shifts: Record<string, number> = {}): TabSection[] {
  const total = score.masterBars.length
  const songStart = sheet.sections.length ? firstMeasureOf(sheet.sections[0]) : 0
  const markers = score.masterBars.flatMap((m, i) => (m.section ? [{ bar: i, text: m.section.text || m.section.marker }] : []))
  const count: Record<string, number> = {}
  return sheet.sections
    .filter((s): s is Section & { kind: 'intro' | 'solo' | 'final' } => !s.lines.length && s.measures.length > 0 && s.kind in MARKER)
    .map((s) => {
      const n = (count[s.kind] = (count[s.kind] ?? 0) + 1)
      const key = `${s.kind}-${n}`
      const found = markers.filter((m) => MARKER[s.kind].test(m.text))[n - 1]
      const byCount = s.measures[0].index - songStart
      const base = found ? found.bar : byCount
      const startBar = Math.max(0, Math.min(total - 1, base + (shifts[key] ?? 0)))
      return {
        key,
        label: n > 1 ? `${s.label} ${n}` : s.label,
        measures: s.measures.map((m) => m.index),
        startBar,
        barCount: Math.max(1, Math.min(s.measures.length, total - startBar)),
        how: found ? 'marcação' : 'contagem',
        marker: found?.text,
      }
    })
}

/** Faixas que dá para mostrar em tablatura (guitarra, violão, baixo...), sem bateria. */
export function stringedTracks(score: Score) {
  return score.tracks.flatMap((t, i) => (t.staves[0]?.isStringed && !t.staves[0]?.isPercussion ? [{ index: i, name: t.name || `Faixa ${i + 1}` }] : []))
}

/**
 * Escolhe a faixa: a que tem mais notas nos trechos INTRO/SOLO/FINAL, com
 * preferência para nomes de guitarra solo e evitando baixo.
 */
export function pickTrack(score: Score, sections: TabSection[]): number {
  const bars = sections.flatMap((s) => Array.from({ length: s.barCount }, (_, k) => s.startBar + k))
  let best = { index: stringedTracks(score)[0]?.index ?? 0, score: -1 }
  for (const { index, name } of stringedTracks(score)) {
    const staff = score.tracks[index].staves[0]
    let notes = 0
    for (const b of bars) for (const v of staff.bars[b]?.voices ?? []) for (const beat of v.beats) notes += beat.notes.length
    let s = notes
    if (/solo|lead|guitarra|guitar/i.test(name)) s *= 1.2
    if (/bass|baixo/i.test(name)) s *= 0.3
    if (s > best.score) best = { index, score: s }
  }
  return best.index
}
