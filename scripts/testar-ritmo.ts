// Testes do treino de ritmo (aba Aprendizado). Rode com: npm run ritmo
import { EXERCISES, exerciseGroups, parseSequence, permutations, sequenceLabel } from '../src/lib/exercises'
import { synthPluck } from '../src/lib/ks'
import { analyzeTake } from '../src/lib/rhythmAnalysis'
import type { Tick } from '../src/lib/rhythmClock'
import { delayStats, histogram, matchOnsets } from '../src/lib/rhythmStats'

let falhas = 0
const confere = (nome: string, ok: boolean, detalhe = '') => {
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${nome}${detalhe ? ` (${detalhe})` : ''}`)
  if (!ok) falhas++
}

// ---- Exercícios ----
const perms = permutations().map((p) => p.join(''))
confere('24 permutações de 1234', perms.length === 24 && new Set(perms).size === 24)
const grupos = new Map(exerciseGroups())
const principaisEOutras = [...(grupos.get('Principais') ?? []), ...(grupos.get('Outras permutações de 1234') ?? [])].map((e) =>
  e.steps.map((s) => s.fingers.join('')).join(''),
)
confere('seletor tem as 24 permutações, sem repetir', new Set(principaisEOutras).size === 24 && principaisEOutras.length === 24)
confere('ids únicos', new Set(EXERCISES.map((e) => e.id)).size === EXERCISES.length)
confere('"1+3 2+4" = 2 ataques', parseSequence('1+3 2+4').length === 2 && sequenceLabel(parseSequence('1+3 2+4')) === '1+3 · 2+4')
const ida = EXERCISES.find((e) => e.name === '1234 → 4321')
confere('ida e volta 1234 → 4321', ida?.steps.map((s) => s.fingers[0]).join('') === '12344321')

// ---- d3lay com áudio sintético ----
// Grade com 1 compasso de contagem. Cada nota do violão (som sintetizado)
// é tocada com um atraso conhecido em relação ao ponto da grade.
const sr = 48000
function montar({
  bpm = 90,
  nps = 1,
  atrasos,
  latencia = 0,
  cliquesNoMic = 0,
  ruido = 0.0005,
  pular = [] as number[],
  extras = [] as { nota: number; ms: number }[],
  offbeat = false,
}: {
  bpm?: number
  nps?: number
  atrasos: number[]
  latencia?: number
  cliquesNoMic?: number
  ruido?: number
  pular?: number[]
  extras?: { nota: number; ms: number }[]
  offbeat?: boolean
}) {
  const startCtx = 2.0 // horário do relógio do áudio na 1ª amostra
  const primeiro = 2.3 // 1º tique da contagem
  const dur = 60 / bpm / nps
  const ticks: Tick[] = []
  for (let i = 0; i < 4; i++)
    ticks.push({ time: primeiro + (i * 60) / bpm, bar: -1, beat: i, sub: 0, nps: 1, note: -1, dur: 60 / bpm, clicked: true, muted: false })
  const inicio = primeiro + (4 * 60) / bpm
  for (let n = 0; n < atrasos.length; n++)
    ticks.push({
      time: inicio + n * dur,
      bar: Math.floor(n / (4 * nps)),
      beat: Math.floor(n / nps) % 4,
      sub: n % nps,
      nps,
      note: n,
      dur,
      clicked: n % nps === 0,
      muted: false,
    })
  const total = Math.ceil((inicio + atrasos.length * dur + 1.5 - startCtx) * sr)
  const x = new Float32Array(total)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  for (let i = 0; i < total; i++) x[i] = rnd() * ruido
  const freqs = [196, 220, 247, 262, 294, 330]
  const tocar = (t: number, f: number, amp = 0.35) => {
    const s = synthPluck({ freq: f, sampleRate: sr, duration: Math.min(1.2, dur * 1.5), t60: 1.5, seed: Math.round(t * 1000) })
    const a = Math.round(t * sr)
    for (let i = 0; i < s.length && a + i < total; i++) if (a + i >= 0) x[a + i] += s[i] * amp
  }
  const alvo = (n: number) => ticks[4 + n].time - startCtx + latencia + (offbeat ? dur / 2 : 0)
  atrasos.forEach((ms, n) => {
    if (!pular.includes(n)) tocar(alvo(n) + ms / 1000, freqs[n % freqs.length])
  })
  for (const e of extras) tocar(alvo(e.nota) + e.ms / 1000, 392, 0.3)
  if (cliquesNoMic > 0)
    for (const t of ticks)
      if (t.clicked) {
        const a = Math.round((t.time - startCtx + latencia) * sr)
        const f = t.beat === 0 && t.sub === 0 ? 1760 : 1100
        for (let i = 0; i < 0.06 * sr; i++) {
          const tt = i / sr
          const tri = (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * f * tt))
          const env = tt < 0.002 ? tt / 0.002 : Math.exp(-(tt - 0.002) / 0.012)
          x[a + i] += tri * env * cliquesNoMic
        }
      }
  return { samples: x, sampleRate: sr, startCtx, ticks }
}

const erroMax = (medidos: number[], esperados: number[]) =>
  medidos.length === esperados.length ? Math.max(...medidos.map((m, i) => Math.abs(m - esperados[i]))) : Infinity
const fmtErro = (e: number) => (Number.isFinite(e) ? `erro máx ${e.toFixed(2)} ms` : 'quantidade diferente')

{
  const atrasos = [10, -20, 45, 0, 5, -8, 30, -35, 15, -3, 22, -12, 0, 8, -25, 40]
  const r = analyzeTake(montar({ atrasos }), { latency: 0, sensitivity: 50, rejectClicks: true })
  const med = r.matching.hits.map((h) => h.delay)
  confere('acha 1 ataque por nota', med.length === atrasos.length && r.matching.extras.length === 0, `${med.length} de ${atrasos.length}`)
  const e = erroMax(med, atrasos)
  confere('d3lay bate com o esperado (±2 ms)', e <= 2, fmtErro(e))
  console.log('      esperado:', atrasos.join(' '))
  console.log('      medido:  ', med.map((d) => d.toFixed(1)).join(' '))
  const st = delayStats(med, 30)
  const stEsp = delayStats(atrasos, 30)
  confere('% de acerto (x = 30 ms)', Math.abs(st.hitPct - stEsp.hitPct) < 0.01, `${st.hitPct.toFixed(1)}%`)
  confere('média com sinal', Math.abs(st.meanSigned - stEsp.meanSigned) < 1, `${st.meanSigned.toFixed(1)} ms`)
}
{
  const atrasos = [12, -18, 33, 0, 7, -9, 25, -4]
  const r = analyzeTake(montar({ atrasos, latencia: 0.045 }), { latency: 0.045, sensitivity: 50 })
  const e = erroMax(r.matching.hits.map((h) => h.delay), atrasos)
  confere('com latência de 45 ms compensada', e <= 2, fmtErro(e))
}
{
  const atrasos = [10, -20, 45, 0, 5, -8, 30, -35, 15, -3, 22, -12]
  const r = analyzeTake(montar({ atrasos, cliquesNoMic: 0.25 }), { latency: 0, sensitivity: 50, rejectClicks: true })
  const e = erroMax(r.matching.hits.map((h) => h.delay), atrasos)
  const ignorados = r.onsets.filter((o) => o.click).length
  confere('clique vazando no microfone é ignorado', e <= 3, `${ignorados} cliques ignorados, ${fmtErro(e)}`)
}
{
  const atrasos = [5, -5, 10, -10, 0, 5, -5, 10, 0, 0, 0, 0]
  const r = analyzeTake(montar({ atrasos, pular: [3, 7], extras: [{ nota: 5, ms: 70 }] }), { latency: 0, sensitivity: 50 })
  confere('beats sem ataque', r.matching.missed === 2, `${r.matching.missed}`)
  confere('ataques extras', r.matching.extras.length === 1, `${r.matching.extras.length}`)
}
{
  // A 120 BPM (500 ms por beat), +45 e +60 ms continuam atrasados, não adiantados.
  const atrasos = [45, 45, -45, 60, -60, 20, 0, 0]
  const r = analyzeTake(montar({ atrasos, bpm: 120 }), { latency: 0, sensitivity: 50 })
  const med = r.matching.hits.map((h) => h.delay)
  confere('sinal: atrasado continua positivo', erroMax(med, atrasos) <= 2, med.map((d) => d.toFixed(0)).join(' '))
}
{
  const atrasos = Array.from({ length: 12 }, (_, i) => [8, -6, 3][i % 3])
  const r = analyzeTake(montar({ atrasos, bpm: 80, nps: 3 }), { latency: 0, sensitivity: 50 })
  const e = erroMax(r.matching.hits.map((h) => h.delay), atrasos)
  confere('tercinas a 80 BPM', e <= 2, fmtErro(e))
}
{
  const atrasos = Array.from({ length: 16 }, (_, i) => [4, -4, 2, 0][i % 4])
  const r = analyzeTake(montar({ atrasos, bpm: 100, nps: 4 }), { latency: 0, sensitivity: 50 })
  const e = erroMax(r.matching.hits.map((h) => h.delay), atrasos)
  confere('4 notas por tempo a 100 BPM (150 ms)', e <= 2, fmtErro(e))
}
{
  const atrasos = [10, -10, 20, -20, 0, 0, 5, -5]
  const r = analyzeTake(montar({ atrasos, offbeat: true }), { latency: 0, sensitivity: 50, offbeat: true })
  const e = erroMax(r.matching.hits.map((h) => h.delay), atrasos)
  confere('contratempo (alvo no "e")', e <= 2, fmtErro(e))
}
{
  // Contas diretas.
  const m = matchOnsets([0.99, 1.52, 1.98, 2.02], [{ time: 1 }, { time: 1.5 }, { time: 2 }, { time: 2.5 }])
  confere('mais próximo, extras e sem ataque', m.hits.length === 3 && m.extras.length === 1 && m.missed === 1)
  const h = histogram([-12, -3, 2, 4, 7], 5)
  confere('histograma em faixas de 5 ms', h.reduce((s, b) => s + b.count, 0) === 5 && h.find((b) => b.from === 0)!.count === 2)
  const st = delayStats([10, -20, 45], 30)
  confere('estatísticas', Math.abs(st.hitPct - 200 / 3) < 0.01 && st.medianAbs === 20 && Math.abs(st.meanAbs - 25) < 1e-9 && Math.abs(st.meanSigned - 35 / 3) < 1e-9)
}

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
