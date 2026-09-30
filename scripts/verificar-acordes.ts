// Confere TODAS as formas de TODOS os acordes da página Acordes.
// Para cada forma, calcula as notas que realmente soam (corda solta + casa)
// e compara com a teoria (tonal). Aponta:
//  - NOTA ERRADA: alguma corda toca uma nota que não é do acorde;
//  - FALTA: falta a tônica, a terça (ou a 2ª/4ª do sus), a sétima, ou a nota
//    que define o acorde (5ª diminuta/aumentada, 6ª, 9ª...);
//  - DEDOS: digitação impossível (mais de 4 dedos, dedo repetido em casas
//    diferentes sem pestana, abertura grande demais).
// Rode com: npm run verificar
import { Chord, Interval, Note } from 'tonal'
import { QUALITIES, ROOTS, chordDisplayName, chordTonalName, inversionShapesFor, shapesFor, type Shape } from '../src/lib/chords'
import { noteAt } from '../src/lib/theory'

const pc = (n: string) => Note.chroma(n)!

// Intervalos que podem faltar sem descaracterizar o acorde (a 5ª justa, e a
// 11ª/13ª "de enfeite" nos acordes estendidos, como é comum no violão).
const OPTIONAL = new Set(['5P', '11P'])

function check(shape: Shape, tonalName: string, inInversions = false) {
  const chord = Chord.get(tonalName)
  const want = new Map(chord.intervals.map((iv, i) => [pc(chord.notes[i]), iv]))
  const problems: string[] = []

  const sounding = shape.frets.flatMap((f, s) => (f < 0 ? [] : [{ s, f, note: noteAt(s, f) }]))
  if (sounding.length < 3) problems.push(`só ${sounding.length} cordas soam`)

  const wrong = sounding.filter((x) => !want.has(pc(x.note)))
  for (const w of wrong) {
    const iv = Interval.distance(chord.tonic!, Note.pitchClass(w.note))
    problems.push(`NOTA ERRADA: ${6 - w.s}ª corda ${w.f === 0 ? 'solta' : `casa ${w.f}`} = ${Note.pitchClass(w.note)} (${iv}), não é do acorde`)
  }

  const heard = new Set(sounding.map((x) => pc(x.note)))
  for (const [p, iv] of want) {
    if (heard.has(p) || OPTIONAL.has(iv)) continue
    // Nos acordes de 13ª, a 9ª e a 11ª costumam ser omitidas.
    if (/^13/.test(chord.aliases[0] ?? '') && (iv === '9M' || iv === '11P')) continue
    // Sem a tônica é uma posição de jazz válida: o app marca "sem tônica" e não conta como erro.
    if (iv === '1P' && shape.rootless) continue
    problems.push(`FALTA: ${Note.pitchClass(chord.notes[[...want.keys()].indexOf(p)])} (${iv})`)
  }

  // Digitação
  const fingers = new Map<number, number[]>() // dedo -> casas
  shape.frets.forEach((f, s) => {
    const d = shape.fingers[s]
    if (f > 0 && d > 0) fingers.set(d, [...(fingers.get(d) ?? []), f])
  })
  if ([...fingers.keys()].some((d) => d > 4)) problems.push('DEDOS: número de dedo maior que 4')
  for (const [d, frets] of fingers) {
    if (new Set(frets).size > 1) problems.push(`DEDOS: dedo ${d} em casas diferentes (${frets.join(', ')})`)
  }
  const pressed = shape.frets.filter((f) => f > 0)
  if (pressed.length && Math.max(...pressed) - Math.min(...pressed) > 4)
    problems.push(`DEDOS: abertura de ${Math.max(...pressed) - Math.min(...pressed) + 1} casas`)
  const needed = new Set(shape.frets.map((f, s) => (f > 0 ? `${shape.fingers[s]}` : '')).filter(Boolean))
  if (shape.fingers.every((d) => d === 0) && pressed.length) problems.push('DEDOS: forma sem digitação')
  if (needed.size > 4) problems.push('DEDOS: precisa de mais de 4 dedos')
  // Pestana: toda corda debaixo dela precisa estar presa nessa casa ou acima
  // (corda solta ou abafada no meio da pestana é impossível).
  for (const b of shape.barres) {
    for (let i = b.from; i <= b.to; i++) {
      if (shape.frets[i] < b.fret) problems.push(`DEDOS: pestana na casa ${b.fret} passa pela ${6 - i}ª corda, que está ${shape.frets[i] < 0 ? 'abafada' : shape.frets[i] === 0 ? 'solta' : 'numa casa mais baixa'}`)
    }
  }
  // Tônica fora do baixo na lista normal = inversão (só vale no filtro Inversões).
  if (!inInversions && (shape.inversion ?? 0) > 0) problems.push(`AVISO: inversão na lista normal (${shape.bass} no baixo)`)

  return problems
}

let total = 0
let bad = 0
let warn = 0
const report: string[] = []
for (const r of ROOTS) {
  for (const q of QUALITIES) {
    const ref = { root: r.name, quality: q }
    const shapes = shapesFor(ref)
    if (shapes.length === 0) {
      report.push(`${chordDisplayName(ref).padEnd(10)} SEM FORMAS no banco`)
      continue
    }
    // As inversões usam também as formas "com barra" do banco (C/E, Am/C...).
    const inversions = inversionShapesFor(ref).filter((x) => !shapes.some((y) => y.frets.join() === x.frets.join()))
    ;[...shapes, ...inversions].forEach((sh, i) => {
      const isInv = i >= shapes.length
      total++
      const p = check(sh, chordTonalName(ref), isInv)
      if (p.length) {
        if (p.every((x) => x.startsWith('AVISO'))) warn++
        else bad++
        const tab = sh.frets.map((f) => (f < 0 ? 'x' : f)).join(' ')
        report.push(`${chordDisplayName(ref).padEnd(10)} #${i + 1} ${sh.label.padEnd(10)} [${tab}]  ${p.join(' | ')}`)
      }
    })
  }
}
console.log(report.join('\n'))
console.log(`\n${bad} de ${total} formas com problema · ${warn} avisos (inversões que não dá para levar à posição fundamental)`)
