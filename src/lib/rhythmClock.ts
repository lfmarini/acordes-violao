import { scheduleClick } from './metronome'

// ---------------------------------------------------------------------------
// Metrônomo do treino de ritmo.
//
// Como o metrônomo da aba (metronome.ts), marca os cliques no relógio do
// áudio (AudioContext), olhando um pouco à frente, para o som sair no tempo
// exato. A diferença é que aqui cada batida pode ser dividida em 1, 2, 3
// (tercina) ou 4 notas: cada divisão é um "tique" da grade de referência.
// Antes de começar, toca 1 compasso de contagem.
//
// Todos os tiques ficam guardados em `ticks`, com o horário exato no relógio
// do áudio. Na etapa de gravação, o microfone usa o mesmo relógio, então os
// beats e os ataques do violão caem na mesma linha do tempo.
// ---------------------------------------------------------------------------

export const RHYTHM_BPM_MIN = 30
export const RHYTHM_BPM_MAX = 240
export const RHYTHM_BPM_DEFAULT = 60
export const NOTES_PER_BEAT = [1, 2, 3, 4] as const

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_S = 0.12
/** Volume do clique das subdivisões (em relação ao clique do beat). */
const SUB_LEVEL = 0.35

export interface Tick {
  /** Horário exato no relógio do áudio (segundos). */
  time: number
  /** Compasso: negativo na contagem (−1), 0 em diante no exercício. */
  bar: number
  /** Tempo dentro do compasso (0 = 1º tempo). */
  beat: number
  /** Divisão dentro do tempo (0 = no tempo). */
  sub: number
  /** Notas por tempo em vigor neste tique. */
  nps: number
  /** Nº da nota do exercício (0, 1, 2…); −1 na contagem. */
  note: number
  /** Duração deste tique até o próximo (s). */
  dur: number
  /** Se o clique soou (na contagem só os tempos soam). */
  clicked: boolean
  /** Compasso silenciado de propósito (modo metrônomo esparso). */
  muted: boolean
}

/** Sequência de notas por tempo do modo escada. */
export const LADDER = [1, 2, 3, 4]

export class RhythmClock {
  bpm = RHYTHM_BPM_DEFAULT
  beatsPerBar = 4
  notesPerBeat = 1
  countInBars = 1
  volume = 0.8
  /** Tocar também um clique fraco nas subdivisões. */
  subClicks = false
  /** Clicar só no 1º tempo de cada compasso. */
  firstBeatOnly = false
  /** Modo escada: troca as notas por tempo (1, 2, 3, 4…) a cada N compassos (0 = desligado). */
  ladderBars = 0
  /** Metrônomo esparso: em cada grupo de `muteEvery` compassos, os últimos `muteBars` ficam em silêncio (0 = desligado). */
  muteEvery = 0
  muteBars = 0
  /** Chamado na hora em que cada tique soa (horário em performance.now). */
  onTick: (tick: Tick, at: number) => void = () => {}
  /** Tudo o que já foi agendado nesta rodada. */
  ticks: Tick[] = []

  private ctx: AudioContext | null = null
  private ownCtx = false
  private out: GainNode | null = null
  private timer = 0
  private pending: number[] = []
  private nextTime = 0
  private bar = 0
  private beat = 0
  private sub = 0
  private nps = 1
  private note = 0

  get running() {
    return this.timer !== 0
  }

  get context() {
    return this.ctx
  }

  /** Começa (com a contagem). `ctx`: relógio de áudio já existente (ex.: o do microfone). */
  start(ctx?: AudioContext) {
    if (this.running) return
    if (ctx && ctx !== this.ctx) {
      this.release()
      this.ctx = ctx
      this.ownCtx = false
    }
    if (this.ctx?.state === 'closed') this.ctx = null // o relógio do microfone já foi fechado
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
      this.ownCtx = true
    }
    if (!this.out || this.out.context !== this.ctx) {
      this.out = this.ctx.createGain()
      this.out.connect(this.ctx.destination)
    }
    void this.ctx.resume() // precisa estar dentro do clique
    this.out.gain.value = this.volume
    this.ticks = []
    this.bar = -Math.max(0, this.countInBars)
    this.beat = 0
    this.sub = 0
    this.nps = this.npsFor(this.bar)
    this.note = 0
    this.nextTime = this.ctx.currentTime + 0.1
    this.timer = window.setInterval(() => this.schedule(), LOOKAHEAD_MS)
    this.schedule()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = 0
    this.pending.forEach(clearTimeout)
    this.pending = []
    // Corta os cliques já agendados que ainda não soaram.
    if (this.out && this.ctx) {
      this.out.disconnect()
      this.out = null
    }
  }

  setVolume(v: number) {
    this.volume = v
    if (this.out) this.out.gain.value = v
  }

  /** Solta o relógio de áudio próprio (ao sair da página). */
  release() {
    this.stop()
    if (this.ctx && this.ownCtx) void this.ctx.close()
    this.ctx = null
  }

  /** Atraso entre o agendamento e o som sair no alto-falante (s), quando o navegador informa. */
  outputDelay() {
    const c = this.ctx
    if (!c) return 0
    return (c.outputLatency || 0) + (c.baseLatency || 0)
  }

  private schedule() {
    const ctx = this.ctx!
    while (this.nextTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      const countIn = this.bar < 0
      const muted = !countIn && this.isMuted(this.bar)
      const beatClick = this.sub === 0 && (countIn || !this.firstBeatOnly || this.beat === 0)
      const tick: Tick = {
        time: this.nextTime,
        bar: this.bar,
        beat: this.beat,
        sub: this.sub,
        nps: this.nps,
        note: countIn ? -1 : this.note,
        dur: 60 / this.bpm / this.nps,
        clicked: !muted && (beatClick || (this.subClicks && !countIn && this.sub > 0)),
        muted,
      }
      if (tick.clicked) {
        const accent = this.sub === 0 && this.beat === 0 && this.beatsPerBar > 1
        scheduleClick(ctx, this.out!, tick.time, accent, this.sub === 0 ? 1 : SUB_LEVEL)
      }
      this.ticks.push(tick)

      // Avisa a tela na hora em que o som sai (inclui a latência de saída).
      const delay = (tick.time - ctx.currentTime + this.outputDelay()) * 1000
      const at = performance.now() + delay
      this.pending.push(window.setTimeout(() => this.onTick(tick, at), Math.max(0, delay)))
      if (this.pending.length > 64) this.pending.splice(0, 32)

      this.advance()
    }
  }

  // Passa para o próximo tique. As notas por tempo só mudam no início de um tempo.
  private advance() {
    this.nextTime += 60 / this.bpm / this.nps
    if (this.bar >= 0) this.note++
    this.sub++
    if (this.sub < this.nps) return
    this.sub = 0
    this.beat++
    if (this.beat >= this.beatsPerBar) {
      this.beat = 0
      this.bar++
    }
    this.nps = this.npsFor(this.bar)
  }

  /** Notas por tempo num compasso (a contagem é sempre 1; no modo escada, muda a cada N compassos). */
  npsFor(bar: number) {
    if (bar < 0) return 1
    if (this.ladderBars > 0) return LADDER[Math.floor(bar / this.ladderBars) % LADDER.length]
    return Math.max(1, this.notesPerBeat)
  }

  /** Compasso silenciado no modo metrônomo esparso. */
  isMuted(bar: number) {
    if (bar < 0 || this.muteEvery <= 0 || this.muteBars <= 0) return false
    const n = Math.min(this.muteBars, this.muteEvery - 1)
    return bar % this.muteEvery >= this.muteEvery - n
  }
}
