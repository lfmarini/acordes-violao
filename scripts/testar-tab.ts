import { mkdirSync, writeFileSync } from 'node:fs'
import * as alphaTab from '@coderline/alphatab'
import { readChordMidi } from '../src/lib/chordMidi'
import { parseLrc } from '../src/lib/lrclib'
import { assemble, newSong } from '../src/lib/song'
import { loadTab, mapSections, pickTrack, stringedTracks } from '../src/lib/tabScore'
import { TOTAL_S, chordMidi, lyricsLrc } from './exemplo-musica'
import { exampleGp, exampleTex } from './exemplo-tab'

// Testa a tablatura dos trechos INTRO/SOLO/FINAL com o arquivo Guitar Pro de
// exemplo (notas inventadas): leitura, escolha da faixa e encaixe nos trechos.
// Grava o .gp em scripts/exemplo/ para testar a importação no app.

let fails = 0
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '✔' : '✘'} ${msg}`)
  if (!ok) fails++
}

const gp = exampleGp()
mkdirSync('scripts/exemplo', { recursive: true })
writeFileSync('scripts/exemplo/Exemplo - Cancao de Teste.gp', gp)

const song = { ...newSong({ id: 't', title: 'Canção de Teste', artist: 'Exemplo', album: '', duration: TOTAL_S, lyrics: parseLrc(lyricsLrc()), synced: true }), track: readChordMidi(chordMidi()), source: 'midi' as const }
const sheet = assemble(song)
const score = loadTab(gp)
check(score.masterBars.length === 53 && score.tracks.length === 2, `arquivo lido: ${score.tracks.length} faixas, ${score.masterBars.length} compassos`)
check(stringedTracks(score).length === 2, 'as duas faixas são de cordas')

const secs = mapSections(score, sheet)
console.log('  ', secs.map((s) => `${s.label}→compasso ${s.startBar + 1} (${s.how}${s.marker ? ` "${s.marker}"` : ''}, ${s.barCount})`).join(' · '))
check(secs.map((s) => s.label).join(',') === 'INTRO,SOLO,FINAL', 'um pedaço de tablatura para cada trecho sem letra')
check(secs.every((s) => s.how === 'marcação'), 'usa as marcações do arquivo (Intro, Solo, Final)')
check(secs[0].startBar === 0 && secs[1].startBar === 36 && secs[2].startBar === 50, 'INTRO no compasso 1, SOLO no 37, FINAL no 51')
check(secs[1].barCount === 6 && secs[2].barCount === 3, 'quantidade de compassos igual à do trecho')
check(pickTrack(score, secs) === 1, `escolhe a guitarra solo: "${score.tracks[pickTrack(score, secs)].name}"`)

// Sem marcações: encaixa contando compassos a partir do começo da música.
const texNoMarkers = exampleTex().replace(/\\section "[^"]*" /g, '')
const importer = new alphaTab.importer.AlphaTexImporter()
importer.initFromString(texNoMarkers, new alphaTab.Settings())
const plain = importer.readScore()
const secs2 = mapSections(plain, sheet)
check(secs2.every((s) => s.how === 'contagem') && secs2[1].startBar === 36, `sem marcações: SOLO pela contagem, compasso ${secs2[1].startBar + 1}`)

// Correção manual (◀ ▶) só mexe no trecho escolhido.
const shifted = mapSections(score, sheet, { 'solo-1': 2 })
check(shifted[1].startBar === 38 && shifted[0].startBar === 0, 'deslocar o SOLO em 2 compassos não mexe na INTRO')
// Nunca passa do fim do arquivo.
const far = mapSections(score, sheet, { 'final-1': 100 })
check(far[2].startBar === 52 && far[2].barCount === 1, 'deslocamento é limitado ao tamanho do arquivo')

console.log(fails ? `\n${fails} teste(s) falharam.` : '\nTudo certo.')
process.exit(fails ? 1 : 0)
