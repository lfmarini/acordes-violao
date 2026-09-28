import * as alphaTab from '@coderline/alphatab'
import { BARS, BPM } from './exemplo-musica'

// ---------------------------------------------------------------------------
// Tablatura de exemplo (Guitar Pro) da música de teste, escrita em AlphaTex e
// exportada pelo próprio alphaTab. Duas faixas: "Violão base" (um acorde por
// compasso, a música toda) e "Guitarra solo" (só toca na intro, no solo e no
// final; o resto é pausa). As marcações de seção seguem a música de exemplo.
// As notas são inventadas (escalas de Sol), não são de nenhuma música real.
// ---------------------------------------------------------------------------

// Compassos (0 = 1º) onde começa cada parte da música de exemplo.
export const TAB_SECTIONS: [number, string][] = [
  [0, 'Intro'],
  [4, 'Verso'],
  [12, 'Refrão'],
  [20, 'Verso'],
  [28, 'Refrão'],
  [36, 'Solo'],
  [42, 'Refrão'],
  [50, 'Final'],
]

// Um acorde por compasso no violão base (tônica na 6ª ou 5ª corda, tocada como semibreve).
const BASS_NOTE: Record<string, string> = { G: '3.6', Em: '0.6', C: '3.5', D: '0.4', Am7: '0.5', D7: '0.4', Gmaj7: '3.6', F: '1.6', 'F#m7b5': '2.6', B7: '2.5' }

// Frases da guitarra solo (8 colcheias por compasso), notas de Sol maior.
const RIFFS = [
  '3.3 5.3 3.2 5.2 3.1 5.1 3.1 5.2',
  '2.3 4.3 5.3 4.3 2.3 0.3 2.4 4.4',
  '5.2 3.2 5.3 3.3 5.4 3.4 5.4 2.4',
  '7.3 5.3 4.3 5.3 7.3 7.2 8.2 7.2',
]

function bar(i: number, solo: boolean) {
  const section = TAB_SECTIONS.find(([b]) => b === i)
  const meta = section ? `\\section "${section[1]}" ` : ''
  if (!solo) {
    const name = BARS[i][0][0].split('/')[0]
    return `${meta}:1 ${BASS_NOTE[name] ?? '3.6'}`
  }
  const inPart = (from: number, to: number) => i >= from && i < to
  const plays = inPart(0, 4) || inPart(36, 42) || inPart(50, 53)
  return `${meta}${plays ? `:8 ${RIFFS[i % RIFFS.length]}` : ':1 r'}`
}

export function exampleTex() {
  const n = BARS.length
  const track = (name: string, solo: boolean) =>
    `\\track "${name}"\n\\staff {score tabs}\n` + Array.from({ length: n }, (_, i) => bar(i, solo)).join(' |\n')
  return `\\title "Canção de Teste"\n\\tempo ${BPM}\n.\n${track('Violão base', false)}\n${track('Guitarra solo', true)}`
}

/** Arquivo Guitar Pro 7 (.gp) com a tablatura de exemplo. */
export function exampleGp(): Uint8Array {
  const settings = new alphaTab.Settings()
  const importer = new alphaTab.importer.AlphaTexImporter()
  importer.initFromString(exampleTex(), settings)
  const score = importer.readScore()
  return new alphaTab.exporter.Gp7Exporter().export(score, settings)
}
