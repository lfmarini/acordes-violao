import * as Tone from 'tone'
import { audioNow, startSongAudio, stopSongAudio, strumAt } from './audio'
import { scheduleClick } from './metronome'
import { chordAt, type Measure, type Sheet } from './song'
import { shapeForSongChord, songChordName, type SongChord } from './songChords'
import type { Shape } from './chords'
import { readStored } from './storage'
import { YT_STATE, type YTPlayer } from './youtube'

// ---------------------------------------------------------------------------
// Motor do karaokê. Há dois tipos de relógio:
//
//  - pelo TEMPO DA GRAVAÇÃO (fontes "YouTube" e "MIDI"): a posição é o
//    segundo da gravação original (lido do vídeo, ou contado pelo app).
//    Como o MIDI do Chordify é alinhado a essa gravação, os compassos seguem
//    o vídeo. INTRO e SOLO tocam normalmente, com o bloco aceso.
//  - pelas BATIDAS (fontes "Acompanhamento" e "Só metrônomo"): o app conta
//    batidas no BPM escolhido, compasso por compasso, pulando INTRO, SOLO e
//    FINAL.
//
// Sons são agendados no relógio do áudio com ~150 ms de antecedência (como
// o metrônomo da aba Aprendizado), para saírem no tempo exato.
// ---------------------------------------------------------------------------

export type SoundSource = 'youtube' | 'midi' | 'acomp' | 'silent'

export const SOURCES: { id: SoundSource; label: string; hint: string }[] = [
  { id: 'youtube', label: 'Gravação (YouTube)', hint: 'o vídeo toca e os blocos seguem o tempo dele' },
  { id: 'midi', label: 'Acordes do MIDI', hint: 'os acordes no som de violão, no tempo da gravação' },
  { id: 'acomp', label: 'Acompanhamento', hint: 'batida simples no BPM escolhido' },
  { id: 'silent', label: 'Só metrônomo', hint: 'silencioso, só o tic no BPM escolhido' },
]

/** Batidas do acompanhamento, em colcheias: D = para baixo, U = para cima, - = pausa. Repetem até encher o compasso. */
export const STRUM_PATTERNS = [
  { id: 'um', label: 'Só no 1º tempo', cell: 'D-------' },
  { id: 'tempos', label: '↓ em cada tempo', cell: 'D-' },
  { id: 'pop', label: '↓ ↓↑', cell: 'D-DU' },
  { id: 'balada', label: '↓ ↓↑ ↑↓↑', cell: 'D-DU-UDU' },
] as const
export type PatternId = (typeof STRUM_PATTERNS)[number]['id']

export interface PlayerOptions {
  source: SoundSource
  rate: number // velocidade: 0,5 a 1,2
  metronome: boolean
  countIn: number // batidas de contagem antes de começar
  bpm: number
  pattern: PatternId
}

export interface PlayPos {
  measure: number
  beat: number
}

export type PlayState = 'stopped' | 'counting' | 'playing' | 'paused'

const LOOKAHEAD_MS = 25
const AHEAD_S = 0.15

export class SongPlayer {
  onPos: (p: PlayPos | null) => void = () => {}
  onState: (s: PlayState) => void = () => {}
  /** Chamado a cada quadro com o segundo da gravação (só nas fontes pelo tempo). */
  onTime: (t: number) => void = () => {}
  /** Recado para mostrar na tela (ex.: o vídeo não começou). */
  onNotice: (text: string) => void = () => {}

  state: PlayState = 'stopped'
  private sheet: Sheet | null = null
  private opts: PlayerOptions = { source: 'midi', rate: 1, metronome: false, countIn: 0, bpm: 90, pattern: 'pop' }
  private yt: YTPlayer | null = null
  private out: GainNode | null = null

  // Relógio pelo tempo da gravação: posição t0 no instante c0 do relógio do áudio.
  private t0 = 0
  private c0 = 0
  // Relógio pelas batidas: batida b0 (da lista `flat`) no instante c0.
  private b0 = 0
  private flat: { measure: number; beat: number }[] = []
  private scheduled = 0 // até onde já foi agendado (segundo da gravação ou batida)
  private ytAnchor = { t: 0, perf: 0 }
  private pendingSeek: number | null = null // posição do vídeo a aplicar no próximo ▶
  private timer = 0
  private raf = 0
  private startTimer = 0
  private last = ''
  private shapes = new Map<string, Shape | null>()

  get timeBased() {
    return this.opts.source === 'youtube' || this.opts.source === 'midi'
  }

  setSheet(sheet: Sheet) {
    const pos = this.position()
    this.sheet = sheet
    // Batidas tocáveis nas fontes pelas batidas: só os compassos das linhas
    // (INTRO, SOLO e FINAL ficam de fora).
    this.flat = sheet.sections
      .flatMap((s) => s.lines.flatMap((l) => l.measures))
      .flatMap((m) => m.beats.map((_, beat) => ({ measure: m.index, beat })))
    if (pos && !this.timeBased) this.b0 = Math.max(0, this.flat.findIndex((f) => f.measure === pos.measure))
    this.emit(true)
  }

  setOptions(next: Partial<PlayerOptions>) {
    const wasPlaying = this.state === 'playing'
    const sourceChanged = next.source && next.source !== this.opts.source
    if (wasPlaying && (sourceChanged || next.rate !== undefined || next.bpm !== undefined)) this.anchor()
    if (sourceChanged) {
      const pos = this.position()
      this.pause()
      this.opts = { ...this.opts, ...next }
      if (pos) this.seekMeasure(pos.measure)
      return
    }
    this.opts = { ...this.opts, ...next }
    if (next.rate !== undefined) this.yt?.setPlaybackRate(next.rate)
    if (wasPlaying) this.scheduled = this.timeBased ? this.songTime() : this.beatNow()
  }

  setYouTube(yt: YTPlayer | null) {
    this.yt = yt
    if (yt) yt.setPlaybackRate(this.opts.rate)
  }

  /** Estado vindo do vídeo (o próprio botão de play do YouTube também comanda o karaokê). */
  ytStateChanged(s: number) {
    if (this.opts.source !== 'youtube') return
    if (s === YT_STATE.PLAYING && this.state !== 'playing') {
      clearTimeout(this.startTimer)
      // Tocou pelo botão do próprio vídeo: aplica a posição que estava guardada.
      if (this.pendingSeek !== null) this.yt?.seekTo(this.pendingSeek, true)
      this.pendingSeek = null
      this.state = 'playing'
      this.scheduled = this.songTime()
      this.loop()
      this.onState('playing')
    } else if ((s === YT_STATE.PAUSED || s === YT_STATE.ENDED) && this.state === 'playing') {
      this.halt()
      this.state = s === YT_STATE.ENDED ? 'stopped' : 'paused'
      this.onState(this.state)
    }
  }

  // --- posição -------------------------------------------------------------------

  private spb() {
    return 60 / (this.opts.bpm * this.opts.rate)
  }

  /**
   * Leva o vídeo a um ponto sem fazê-lo tocar. No YouTube, "seekTo" num vídeo
   * que ainda não começou (ou já terminou) faz ele começar a tocar; só um vídeo
   * pausado continua pausado. Então, nesses casos, guardamos a posição e ela
   * vale quando você apertar ▶.
   */
  private ytSeek(t: number) {
    const st = this.yt?.getPlayerState()
    if (st === YT_STATE.PLAYING || st === YT_STATE.PAUSED || st === YT_STATE.BUFFERING) {
      this.pendingSeek = null
      this.yt?.seekTo(t, true)
    } else this.pendingSeek = t
  }

  /** Segundo da gravação agora. */
  songTime(): number {
    if (this.opts.source === 'youtube' && this.state !== 'playing' && this.pendingSeek !== null) return this.pendingSeek
    if (this.opts.source === 'youtube' && this.yt) {
      const t = this.yt.getCurrentTime() ?? 0
      const now = performance.now()
      if (t !== this.ytAnchor.t) this.ytAnchor = { t, perf: now }
      // O vídeo atualiza o tempo aos saltinhos; entre eles, estimamos.
      return this.state === 'playing' ? this.ytAnchor.t + ((now - this.ytAnchor.perf) / 1000) * this.opts.rate : t
    }
    if (this.state !== 'playing') return this.t0
    return this.t0 + Math.max(0, audioNow() - this.c0) * this.opts.rate
  }

  private beatNow(): number {
    if (this.state !== 'playing') return this.b0
    return this.b0 + Math.max(0, audioNow() - this.c0) / this.spb()
  }

  position(): PlayPos | null {
    const sheet = this.sheet
    if (!sheet?.measures.length) return null
    if (!this.timeBased) {
      const f = this.flat[Math.min(Math.floor(this.beatNow()), this.flat.length - 1)]
      return f ? { measure: f.measure, beat: f.beat } : null
    }
    return posAtTime(sheet.measures, this.songTime())
  }

  private emit(force = false) {
    const p = this.position()
    const key = p ? `${p.measure}:${p.beat}` : ''
    if (force || key !== this.last) {
      this.last = key
      this.onPos(this.state === 'stopped' && !force ? null : p)
    }
    if (this.timeBased) this.onTime(this.songTime())
  }

  // --- comandos ------------------------------------------------------------------

  async play() {
    if (this.state === 'playing' || this.state === 'counting' || !this.sheet) return
    await startSongAudio()
    this.ensureOut()
    const now = audioNow()
    const lead = 0.08
    // Contagem de entrada: cliques no BPM, e só depois a música começa.
    const n = this.opts.countIn
    const spb = this.timeBased ? 60 / (this.sheet.bpm * this.opts.rate) : this.spb()
    for (let k = 0; k < n; k++) scheduleClick(this.ctx(), this.out!, now + lead + k * spb, k === 0, this.clickLevel())
    const start = now + lead + n * spb
    if (this.state === 'stopped' && !this.timeBased) this.b0 = 0
    if (this.state === 'stopped' && this.timeBased && this.opts.source === 'midi') this.t0 = this.sheet.sections[0]?.start ?? 0

    if (this.opts.source === 'youtube') {
      if (!this.yt) return
      this.state = 'counting'
      this.onState('counting')
      this.startTimer = window.setTimeout(() => {
        // Posição guardada enquanto o vídeo ainda não tinha começado (ver ytSeek).
        if (this.pendingSeek !== null) this.yt?.seekTo(this.pendingSeek, true)
        this.pendingSeek = null
        this.yt?.playVideo()
        // Alguns celulares só deixam o vídeo começar com um toque no próprio vídeo.
        this.startTimer = window.setTimeout(() => {
          if (this.state !== 'counting') return
          this.state = 'paused'
          this.onState('paused')
          this.onNotice('O vídeo não começou sozinho. Toque uma vez no ▶ do próprio vídeo; daí em diante o karaokê acompanha.')
        }, 3000)
      }, (start - now) * 1000)
      return // o estado "tocando" chega pelo ytStateChanged
    }
    this.c0 = start
    this.scheduled = this.timeBased ? this.t0 : this.b0 - 1e-6
    this.state = 'playing'
    this.onState(n ? 'counting' : 'playing')
    if (n) this.startTimer = window.setTimeout(() => this.state === 'playing' && this.onState('playing'), (start - now) * 1000)
    this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_MS)
    this.tick()
    this.loop()
  }

  pause() {
    if (this.state === 'stopped' || this.state === 'paused') return
    this.anchor()
    this.halt()
    this.yt?.pauseVideo()
    this.state = 'paused'
    this.onState('paused')
  }

  stop() {
    this.halt()
    this.yt?.pauseVideo()
    this.state = 'stopped'
    this.t0 = this.sheet?.sections[0]?.start ?? 0
    this.b0 = 0
    if (this.opts.source === 'youtube') this.ytSeek(0)
    this.onState('stopped')
    this.last = ''
    this.onPos(null)
  }

  /** Pula para o começo de um compasso. */
  seekMeasure(index: number) {
    const m = this.sheet?.measures[index]
    if (!m) return
    const playing = this.state === 'playing'
    if (this.timeBased) {
      this.t0 = m.start
      if (this.opts.source === 'youtube') this.ytSeek(m.start)
    } else {
      const i = this.flat.findIndex((f) => f.measure >= index)
      this.b0 = i < 0 ? 0 : i
    }
    if (playing) {
      stopSongAudio()
      this.c0 = audioNow() + 0.05
      this.scheduled = this.timeBased ? this.t0 : this.b0 - 1e-6
    } else if (this.state === 'stopped') this.state = 'paused'
    this.emit(true)
  }

  /** Volta ao início da seção que está tocando. */
  sectionStart() {
    const pos = this.position()
    const sheet = this.sheet
    if (!pos || !sheet) return
    const sec = sheet.sections.find((s) => sectionMeasures(s).some((m) => m.index === pos.measure))
    const first = sec && sectionMeasures(sec)[0]
    if (first) this.seekMeasure(first.index)
  }

  destroy() {
    this.halt()
  }

  // --- por dentro --------------------------------------------------------------------

  private ctx() {
    return Tone.getContext().rawContext as unknown as BaseAudioContext
  }
  private ensureOut() {
    if (this.out) return
    this.out = this.ctx().createGain()
    this.out.connect(this.ctx().destination)
  }
  private clickLevel() {
    return readStored('metronomo-volume', 0.8)
  }

  // Guarda a posição atual como novo ponto de partida (antes de mudar velocidade etc.).
  private anchor() {
    if (this.timeBased) this.t0 = this.songTime()
    else this.b0 = this.beatNow()
    this.c0 = audioNow()
  }

  private halt() {
    clearInterval(this.timer)
    clearTimeout(this.startTimer)
    cancelAnimationFrame(this.raf)
    this.timer = 0
    stopSongAudio()
  }

  private loop() {
    cancelAnimationFrame(this.raf)
    const frame = () => {
      this.emit()
      // Tocou até o fim da música.
      const sheet = this.sheet
      if (sheet && this.opts.source === 'midi' && this.songTime() > (sheet.measures[sheet.measures.length - 1]?.end ?? 0) + 1) return this.stop()
      if (sheet && !this.timeBased && this.beatNow() >= this.flat.length) return this.stop()
      if (this.opts.source === 'youtube' && this.state === 'playing' && !this.timer) this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_MS)
      this.raf = requestAnimationFrame(frame)
    }
    this.raf = requestAnimationFrame(frame)
  }

  private shape(c: SongChord | null) {
    if (!c) return null
    const k = songChordName(c)
    if (!this.shapes.has(k)) this.shapes.set(k, shapeForSongChord(c))
    return this.shapes.get(k)!
  }

  // Agenda o que cai nos próximos ~150 ms.
  private tick() {
    const sheet = this.sheet
    if (!sheet || this.state !== 'playing') return
    const now = audioNow()
    if (this.timeBased) {
      const t = this.songTime()
      const until = t + AHEAD_S * this.opts.rate
      const at = (songT: number) => now + (songT - t) / this.opts.rate
      for (const m of sheet.measures) {
        if (m.end < this.scheduled || m.start > until) continue
        m.beats.forEach((bt, b) => {
          if (bt <= this.scheduled || bt > until) return
          if (this.opts.metronome) scheduleClick(this.ctx(), this.out!, at(bt), b === 0, this.clickLevel())
          if (this.opts.source === 'midi') {
            const c = m.chords.find((x) => x.beat === b)
            const s = c && this.shape(c.chord)
            if (s) strumAt(s, Math.max(now, at(bt)))
          }
        })
      }
      this.scheduled = Math.max(this.scheduled, until)
      return
    }
    // Pelas batidas: passos de colcheia (meia batida).
    const spb = this.spb()
    const until = this.beatNow() + AHEAD_S / spb
    const cellOf = STRUM_PATTERNS.find((p) => p.id === this.opts.pattern)?.cell ?? 'D-'
    for (let e = Math.floor(this.scheduled * 2) + 1; e / 2 <= until; e++) {
      const B = e / 2
      if (B <= this.scheduled) continue
      const f = this.flat[Math.floor(B)]
      if (!f) break
      const when = this.c0 + (B - this.b0) * spb
      const half = e % 2
      if (this.opts.metronome && !half) scheduleClick(this.ctx(), this.out!, when, f.beat === 0, this.clickLevel())
      if (this.opts.source === 'acomp') {
        const stroke = cellOf[(f.beat * 2 + half) % cellOf.length]
        const s = stroke !== '-' && this.shape(chordAt(sheet.measures[f.measure], f.beat))
        if (s) strumAt(s, Math.max(now, when), { up: stroke === 'U' })
      }
    }
    this.scheduled = Math.max(this.scheduled, until)
  }
}

function sectionMeasures(s: Sheet['sections'][number]): Measure[] {
  return s.lines.length ? s.lines.flatMap((l) => l.measures) : s.measures
}

/** Compasso e tempo num segundo da gravação. */
export function posAtTime(measures: Measure[], t: number): PlayPos | null {
  if (!measures.length) return null
  let lo = 0
  let hi = measures.length - 1
  if (t < measures[0].start) return null
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (measures[mid].start <= t) lo = mid
    else hi = mid - 1
  }
  const m = measures[lo]
  let beat = 0
  m.beats.forEach((b, i) => {
    if (b <= t) beat = i
  })
  return { measure: m.index, beat }
}
