import { parseChord, suggest } from '../src/lib/parser'
import { shapesFor, chordDisplayName, QUALITIES, qualityOfTonalChord } from '../src/lib/chords'
import { analyze, describeInterval, noteAt } from '../src/lib/theory'
import { Chord } from 'tonal'
for (const q of QUALITIES) { const c = Chord.get('C'+q.tonal); if (c.empty || qualityOfTonalChord(c.intervals)!==q) console.log('BAD QUALITY', q.id, c.intervals) }
const tests = ['C','Am','G7','F','C7M','Bm7b5','E9','D°','A+','Dsus4','am7','C 7M','Cmaj7','F#m7b5','Bb7','bb7','Cdim','C°7','Cm7(b5)','C7(9)','C7+','Cm7M','Co','xyz','Cqq','C/E','Ebm','Db7M(9)','C(9)','csus','Cø']
for (const t of tests) { const r = parseChord(t); if (!r.ok) { console.log(t,'=> ERR',r.error); continue }
 const s = shapesFor(r.chord); const a = analyze(r.chord)
 console.log(t,'=>',chordDisplayName(r.chord), s.length,'formas', s.map(x=>x.label).join('|'), '::', a.members.map(m=>m.note+'='+describeInterval(m.interval)).join(', '))
}
const c = shapesFor((parseChord('C') as any).chord)[0]; console.log(JSON.stringify(c), c.frets.map((f,i)=>f<0?'x':noteAt(i,f)))
const f = shapesFor((parseChord('F') as any).chord)[0]; console.log(JSON.stringify(f))
console.log(suggest('C').map(chordDisplayName).join(' '), '|', suggest('am').map(chordDisplayName).join(' '), '|', suggest('F#m7').map(chordDisplayName).join(' '), '|', suggest('c7').map(chordDisplayName).join(' '))
