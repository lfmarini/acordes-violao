// ---------------------------------------------------------------------------
// Metrônomo com agendamento preciso.
//
// O relógio do JavaScript (setTimeout) atrasa alguns milissegundos de forma
// irregular, o que faria o metrônomo "tropeçar". Por isso usamos o relógio
// do áudio: a cada 25 ms olhamos 120 ms à frente e já marcamos no relógio
// do áudio os cliques que caem nessa janela. O som sai no tempo exato.
// ---------------------------------------------------------------------------

export const BPM_MIN = 40
export const BPM_MAX = 200
export const BPM_DEFAULT = 80

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_S = 0.12

// Nomes tradicionais de andamento (aproximados).
export function tempoName(bpm: number) {
  if (bpm < 60) return 'Largo'
  if (bpm < 76) return 'Adagio'
  if (bpm < 108) return 'Andante'
  if (bpm < 120) return 'Moderato'
  if (bpm < 168) return 'Allegro'
  return 'Presto'
}

export class Metronome {
  bpm = BPM_DEFAULT
  beatsPerBar = 4
  volume = 0.8
  /** Chamado na hora em que cada batida soa (índice da batida, horário em performance.now()). */
  onBeat: (beat: number, at: number) => void = () => {}

  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private timer = 0
  private nextTime = 0
  private beat = 0
  private pending: number[] = []

  get running() {
    return this.timer !== 0
  }

  start() {
    if (this.running) return
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.out = this.ctx.createGain()
      this.out.connect(this.ctx.destination)
    }
    void this.ctx.resume() // precisa estar dentro do clique
    this.out!.gain.value = this.volume
    this.beat = 0
    this.nextTime = this.ctx.currentTime + 0.06
    this.timer = window.setInterval(() => this.schedule(), LOOKAHEAD_MS)
    this.schedule()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = 0
    this.pending.forEach(clearTimeout)
    this.pending = []
  }

  setVolume(v: number) {
    this.volume = v
    if (this.out) this.out.gain.value = v
  }

  private schedule() {
    const ctx = this.ctx!
    while (this.nextTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      const accent = this.beat === 0 && this.beatsPerBar > 1
      this.click(this.nextTime, accent)
      const beat = this.beat
      const delay = (this.nextTime - ctx.currentTime) * 1000
      const at = performance.now() + delay
      this.pending.push(window.setTimeout(() => this.onBeat(beat, at), Math.max(0, delay)))
      if (this.pending.length > 32) this.pending.splice(0, 16)
      this.nextTime += 60 / this.bpm
      this.beat = (this.beat + 1) % this.beatsPerBar
    }
  }

  // Clique curto: um "tic" agudo no 1º tempo do compasso e um mais grave nos outros.
  private click(time: number, accent: boolean) {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = accent ? 1760 : 1100
    env.gain.setValueAtTime(0.0001, time)
    env.gain.exponentialRampToValueAtTime(accent ? 1 : 0.6, time + 0.002)
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.06)
    osc.connect(env).connect(this.out!)
    osc.start(time)
    osc.stop(time + 0.07)
  }
}
