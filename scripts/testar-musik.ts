import { mkdirSync, writeFileSync } from 'node:fs'
import { readChordMidi } from '../src/lib/chordMidi'
import { parseLrc } from '../src/lib/lrclib'
import { assemble, chordAt, chordChanges, newSong, nextChord, trackFromTaps, type Song } from '../src/lib/song'
import { posAtTime } from '../src/lib/songPlayer'
import { parsePastedChords, trackFromPaste } from '../src/lib/pasteChords'
import { trackFromAnalysis, trimLeadingSilence } from '../src/lib/audioAnalysis'
import { parseSongChord, songChordName } from '../src/lib/songChords'
import { BARS, BPM, TOTAL_S, chordMidi, lyricsLrc } from './exemplo-musica'

// Testa a aba Musik player sem navegador: gera o MIDI e a letra de exemplo,
// lê o MIDI, monta a folha e confere o resultado. Também grava os arquivos
// em scripts/exemplo/ para testar a importação no app.

let fails = 0
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '✔' : '✘'} ${msg}`)
  if (!ok) fails++
}

const midiBytes = chordMidi()
const lrc = lyricsLrc()
mkdirSync('scripts/exemplo', { recursive: true })
writeFileSync('scripts/exemplo/Exemplo - Cancao de Teste.mid', midiBytes)
writeFileSync('scripts/exemplo/exemplo.lrc', lrc)

// --- MIDI -------------------------------------------------------------------
const track = readChordMidi(midiBytes)
check(Math.abs(track.bpm - BPM) < 0.5, `BPM lido do MIDI: ${track.bpm}`)
check(track.beatsPerBar === 4, `compasso: ${track.beatsPerBar}/${track.beatUnit}`)
check(track.key.name === 'G', `tom estimado: ${track.key.name}`)
check(track.downbeat === 2, `1º tempo descoberto na batida ${track.downbeat} (esperado 2)`)
const names = track.chords.map((c) => songChordName(c.chord))
const expected = BARS.flat().map(([n]) => songChordName(parseSongChord(n)))
  .filter((n, i, all) => i === 0 || n !== all[i - 1])
check(names.join(' ') === expected.join(' '), `sequência de acordes (${names.length})`)
for (const want of ['G7M', 'F#m7(b5)', 'G/B', 'Am7', 'D7', 'B7']) check(names.includes(want), `nome brasileiro: ${want}`)
console.log('  ', names.slice(0, 16).join(' | '), '…')

// --- Montagem -----------------------------------------------------------------
const lines = parseLrc(lrc)
const song: Song = { ...newSong({ id: 't', title: 'Canção de Teste', artist: 'Exemplo', album: '', duration: TOTAL_S, lyrics: lines, synced: true }), track, source: 'midi' }
const sheet = assemble(song)
const labels = sheet.sections.map((s) => s.label)
console.log('   seções:', labels.join(' · '))
check(
  labels.join(',') === 'INTRO,Verso 1,Refrão,Verso 2,Refrão,SOLO,Refrão,FINAL',
  'seções: INTRO, versos, refrões, SOLO e FINAL no lugar certo',
)
check(sheet.sections[0].measures.length === 4, `INTRO com ${sheet.sections[0].measures.length} compassos guardados (esperado 4)`)
check(sheet.sections.find((s) => s.kind === 'solo')!.measures.length === 6, 'SOLO com 6 compassos guardados')
check(sheet.warnings.length === 0, 'sem aviso de duração (letra e MIDI da mesma versão)')
check(sheet.chordsInOrder.map(songChordName).slice(0, 4).join(' ') === 'G Em C D', 'tabela de acordes na ordem em que aparecem')

const v1 = sheet.sections[1]
const firstLine = v1.lines[0]
console.log('   1ª linha em blocos:', firstLine.measures.map((m) => `[${m.chords.map((c) => songChordName(c.chord)).join(' ')}] ${m.lyric}`).join('  '))
check(v1.lines.length === 4 && firstLine.measures.length === 2, 'Verso 1: 4 linhas de 2 compassos')
check(firstLine.measures.map((m) => m.lyric).join(' ') === firstLine.text, 'letra da linha repartida entre os compassos, sem perder palavras')
const refrao = sheet.sections[2]
const split = refrao.lines[1].measures[0]
check(split.chords.length === 2 && split.chords[1].beat === 2, `dois acordes no compasso, o 2º no 3º tempo: ${split.chords.map((c) => `${songChordName(c.chord)}@${c.beat + 1}`).join(' ')}`)

// Ajuste fino: atrasar a letra em 1 compasso desloca as linhas.
const shifted = assemble({ ...song, lyricOffset: (60 / BPM) * 4 })
const shiftedFirst = shifted.sections.find((s) => s.kind === 'verso')!.lines[0].measures[0]
check(shiftedFirst.index === firstLine.measures[0].index + 1, 'ajuste fino da letra (+1 compasso) desloca a letra')

// Aviso de versões diferentes.
const other = assemble({ ...song, duration: TOTAL_S + 40 })
check(other.warnings.length === 1, 'aviso quando a letra dura bem mais que o MIDI')

// Letra sem tempo: distribui as linhas pelos acordes.
const plain = assemble({ ...song, synced: false, lyrics: lines.map((l) => ({ t: null, text: l.text })) })
const plainLines = plain.sections.flatMap((s) => s.lines)
check(plainLines.length > 10 && plainLines.every((l) => l.measures.length > 0), `letra sem tempo espalhada: ${plainLines.length} linhas`)

// Edição de compasso.
const edited = assemble({ ...song, measureEdits: { [firstLine.measures[0].index]: [{ beat: 0, chord: { root: 'C', q: '7M' } }] } })
const editedM = edited.measures[firstLine.measures[0].index]
check(editedM.edited && songChordName(editedM.chords[0].chord) === 'C7M', 'edição de compasso substitui o acorde')

// Deslocar o 1º tempo manualmente.
const moved = assemble({ ...song, downbeatShift: 1 })
check(moved.measures[1].start !== sheet.measures[1].start, 'deslocar o 1º tempo muda a divisão dos compassos')

// --- Etapa 2: tempo, sincronia e karaokê -----------------------------------------
console.log('\n— tempo e karaokê —')
const m0 = firstLine.measures[0]
const pos = posAtTime(sheet.measures, m0.beats[2] + 0.01)
check(pos?.measure === m0.index && pos.beat === 2, `posição no tempo da gravação: compasso ${pos?.measure}, tempo ${(pos?.beat ?? -1) + 1}`)
check(posAtTime(sheet.measures, -0.5) === null, 'antes do início da gravação não acende nada')
check(posAtTime(sheet.measures, 0.1)?.measure === 0 && !sheet.sections.some((s) => [...s.measures, ...s.lines.flatMap((l) => l.measures)].some((m) => m.index === 0)), 'silêncio inicial fica num compasso que não aparece na página')
const cur = chordAt(sheet.measures[m0.index], 0)
check(songChordName(cur) === 'G' && songChordName(nextChord(sheet, m0.index, 0)) === 'Em', `"agora" e "a seguir": ${songChordName(cur)} → ${songChordName(nextChord(sheet, m0.index, 0))}`)

const changes = chordChanges(sheet)
check(changes.length === names.length, `sequência para "marcar tempo": ${changes.length} trocas`)
// Toques 0,3 s atrasados em relação ao MIDI: a nova marcação segue os toques.
const taps = track.chords.map((c) => c.start + 0.3)
const tapped = trackFromTaps(song, sheet, taps, changes)
check(tapped.chords.length === changes.length && Math.abs(tapped.chords[5].start - (track.chords[5].start + 0.3)) < 1e-9, 'marcar tempo: acordes nos instantes tocados')
check(tapped.beats === track.beats, 'marcar tempo: mantém as batidas do MIDI')
// Sem MIDI (só a sequência): cria a grade de batidas no BPM, com o 1º toque num 1º tempo.
const noMidi = { ...song, track: undefined, autoTrack: undefined }
const grid = trackFromTaps(noMidi, sheet, taps, changes)
const gridSheet = assemble({ ...noMidi, track: grid, source: 'tap' })
const firstM = gridSheet.measures.find((m) => m.chords.some((c) => c.chord))!
check(grid.beats.length > 100 && Math.abs(firstM.start - taps[0]) < 0.01, 'marcar tempo sem MIDI: compasso começa no 1º toque')

const faster = assemble({ ...song, bpmOverride: 120 })
check(faster.bpm === 120, 'BPM editado vale para a folha')
const waltz = assemble({ ...song, meter: '3/4' })
check(waltz.beatsPerBar === 3 && waltz.measures.every((m, i) => i === 0 || m.beats.length <= 3), 'compasso 3/4 reagrupa as batidas de 3 em 3')

// --- Etapa 3: cifra colada e conversão da análise de áudio ---------------------------
console.log('\n— alternativas sem MIDI —')
// Cifra inventada, nos dois formatos, sobre a letra inventada do exemplo.
const overLyrics = [
  'Intro: G  Em  C  D',
  '',
  '[Verso]',
  'G                 Em',
  'era uma vez uma canção de teste',
  'C                     D',
  'feita só pra conferir o app',
  'E|---3---2---0---|',
  'Refrão:',
  'C         D        G   G/B',
  'canta comigo esse refrão de mentira',
].join('\n')
const chordPro = '[G]era uma vez uma can[Em]ção de teste\n[C]feita só pra confe[D]rir o app\n[Am7]canta comigo [D7(9)]esse refrão'
const p1 = parsePastedChords(overLyrics)
check(p1.length === 4, `acorde sobre a letra: ${p1.length} linhas (intro + 3 com letra)`)
check(p1[0].lyric === '' && p1[0].chords.map((c) => songChordName(c.chord)).join(' ') === 'G Em C D', 'linha de intro só com acordes')
check(p1[1].chords[1].pos === 18 && p1[1].lyric.startsWith('era uma vez'), 'acorde fica na coluna certa da letra')
check(p1[3].chords.map((c) => songChordName(c.chord)).join(' ') === 'C D G G/B', 'baixo trocado (G/B) na cifra colada')
const p2 = parsePastedChords(chordPro)
check(p2.length === 3 && p2[0].lyric === 'era uma vez uma canção de teste' && p2[0].chords[1].pos === 'era uma vez uma can'.length, 'ChordPro: [G]palavra')
check(songChordName(p2[2].chords[1].chord) === 'D9', 'ChordPro: D7(9) vira D9')

const pasteTrack = trackFromPaste(song, p1, BPM, 4)
const verse1 = lines.find((l) => l.text.startsWith('era uma vez'))!
const gAt = pasteTrack.chords.find((c) => c.chord?.root === 'G' && c.start > 5)!
check(Math.abs(gAt.start - verse1.t!) < 0.01, `cifra colada casa com o tempo da letra (G em ${gAt.start.toFixed(2)} s)`)
check(pasteTrack.chords[0].start < verse1.t!, 'acordes da intro entram antes da 1ª linha')
const pasteSheet = assemble({ ...song, track: pasteTrack, source: 'manual' })
check(pasteSheet.sections.some((s) => s.kind === 'verso') && pasteSheet.chordsInOrder.length >= 5, 'folha montada a partir da cifra colada')

// Resultado "de mentira" do Essentia (o teste real está em npm run analise).
const fake = { bpm: 100.2, ticks: [0.5, 1.1, 1.7, 2.3, 2.9, 3.5, 4.1, 4.7, 5.3], key: 'Bb', scale: 'major', chords: ['Bb', 'Bb', 'Bb', 'Bb', 'Gm', 'Gm', 'Eb', 'F'], strength: [] }
const at = trackFromAnalysis(fake, 6, 1)
check(at.chords.map((c) => songChordName(c.chord)).join(' ') === 'Bb Gm Eb F' && at.key.name === 'Bb', 'análise: acordes por batida, com bemóis no tom de Bb')
check(Math.abs(at.chords[0].start - 1.5) < 1e-9, 'análise: soma o silêncio tirado do começo')
const sil = new Float32Array(44100 * 2)
sil.fill(0.3, 44100)
const trimmed = trimLeadingSilence(sil)
check(Math.abs(trimmed.trimmed - 0.95) < 0.06, `tira o silêncio do começo da gravação (${trimmed.trimmed.toFixed(2)} s)`)

// --- Acorde repetido em cada tempo (MIDI que toca o acorde curtinho a cada batida) ---
console.log('\n— acorde repetido no compasso —')
{
  const beat = 0.6
  const beats = Array.from({ length: 17 }, (_, i) => i * beat)
  const G = { root: 'G', q: 'maior' }
  const D = { root: 'D', q: 'maior' }
  // G nos 4 tempos do 1º compasso e D nos 4 do 2º, cada toque com metade do tempo e silêncio depois.
  const chords = beats.slice(0, 8).flatMap((b, i) => [
    { start: b, end: b + beat / 2, chord: i < 4 ? G : D },
    { start: b + beat / 2, end: b + beat, chord: null },
  ])
  const stac = assemble({
    ...newSong({ id: 's', title: '', artist: '', album: '', duration: 10, lyrics: [], synced: false }),
    track: { chords, beats, beatsPerBar: 4, beatUnit: 4, bpm: 100, key: track.key, duration: 10, downbeat: 0 },
  })
  const shownIn = (i: number) => stac.measures[i].chords.map((c) => `${songChordName(c.chord)}@${c.beat + 1}`).join(' ')
  check(stac.measures[0].chords.length === 1, `compasso de G tocado em cada tempo mostra o acorde uma vez só: ${shownIn(0)}`)
  check(shownIn(1) === 'D@1', `troca para D no 1º tempo do compasso seguinte: ${shownIn(1)}`)
}

console.log(fails ? `\n${fails} teste(s) falharam.` : '\nTudo certo.')
process.exit(fails ? 1 : 0)
