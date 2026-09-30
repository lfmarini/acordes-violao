// Gera a lista de ajustes automáticos (formas "antes → depois") em Markdown.
// Rode com: npx tsx scripts/relatorio-ajustes.ts > ajustes.md
import { QUALITIES, ROOTS, bankShapes, chordDisplayName, shapesFor, INVERSION_NAMES } from '../src/lib/chords'
const tab = (f: number[]) => f.map((x) => (x < 0 ? 'x' : x)).join(' ')
const rootRows: string[] = []
const keepRows: string[] = []
for (const r of ROOTS)
  for (const q of QUALITIES) {
    const ref = { root: r.name, quality: q }
    const final = shapesFor(ref)
    const finalSet = new Set(final.map((s) => s.frets.join()))
    for (const b of bankShapes(ref)) {
      if ((b.inversion ?? 0) <= 0) continue
      if (finalSet.has(b.frets.join())) {
        keepRows.push(`| ${chordDisplayName(ref)} | ${tab(b.frets)} | ${INVERSION_NAMES[b.inversion!]} (${b.bass} no baixo) |`)
        continue
      }
      // a forma ajustada é a que tem as mesmas casas nas cordas que continuam tocando
      const adj = final.find((s) => s.frets.every((f, i) => f < 0 || f === b.frets[i]) && (s.inversion ?? 0) <= 0)
      rootRows.push(`| ${chordDisplayName(ref)} | ${tab(b.frets)} (${b.bass} no baixo) | ${adj ? tab(adj.frets) : '(igual a outra forma)'} |`)
    }
  }
console.log(`## Inversões levadas à posição fundamental (${rootRows.length})\n\n| Acorde | Antes | Depois |\n|---|---|---|\n${rootRows.join('\n')}`)
console.log(`\n## Inversões mantidas, com aviso (${keepRows.length})\n\n| Acorde | Forma | Baixo |\n|---|---|---|\n${keepRows.join('\n')}`)
