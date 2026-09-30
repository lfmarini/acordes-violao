import { Chord, Note } from 'tonal'
import { QUALITIES, ROOTS, chordDisplayName, qualityOfTonalChord, shapesFor, type ChordRef } from './chords'

// ---------------------------------------------------------------------------
// Parser de cifras: aceita a notação brasileira e a internacional.
//
// O tonal só entende a notação internacional (Cmaj7, Cdim, Caug...). Então,
// antes de chamar o tonal, "traduzimos" o que é jeito brasileiro de escrever:
//
//   C7M, C7+      -> Cmaj7   (sétima maior; no Brasil o "M" vem depois do 7)
//   Cm7M          -> CmMaj7  (menor com sétima maior)
//   C°, Co, Cº    -> Cdim    (diminuto)
//   C°7           -> Cdim7
//   Cø            -> Cm7b5   (meio-diminuto)
//   C+, C5+       -> Caug    (aumentado)
//   Cm7(b5)       -> Cm7b5   (parênteses são só agrupamento)
//   C7(9)         -> C9      (sétima com nona)
//   C(9), C(add9) -> Cadd9   (nona adicionada, sem sétima)
//   C7M(9)        -> Cmaj9
//
// Também aceitamos minúsculas e espaços: "am7", "c 7m", "bb7".
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; chord: ChordRef; bass?: string } // bass: nota pedida no baixo (inversão, ex.: C/E)
  | { ok: false; error: string }

const ROOT_RE = /^([a-g])([#♯]|b(?!5)|♭)?(.*)$/i

export function translateSuffix(raw: string): string {
  let s = raw.replace(/\s+/g, '').replace(/♯/g, '#').replace(/♭/g, 'b')

  // Símbolos de diminuto e meio-diminuto.
  s = s.replace(/[°º]/g, 'dim').replace(/ø/g, 'm7b5')
  if (/^o7?$/i.test(s)) s = s.replace(/^o/i, 'dim')

  // Parênteses: tratamos os casos comuns da cifra brasileira.
  const paren = s.match(/^(.*?)\((.+)\)$/)
  if (paren) {
    const [, base, inner] = paren
    const cleanInner = inner.replace(/^add/i, '')
    if (cleanInner === '9' && /^(7|m7|7M|7m|maj7)$/.test(base)) {
      // 7(9) = 9, m7(9) = m9, 7M(9) = maj9
      s = { '7': '9', m7: 'm9', '7M': 'maj9', '7m': 'maj9', maj7: 'maj9' }[base]!
    } else if (cleanInner === '9' && (base === '' || base === 'm')) {
      s = base + 'add9' // C(9) e Cm(9): nona adicionada
    } else {
      s = base + inner // m7(b5) -> m7b5, 7(b9) -> 7b9
    }
  }

  // Sétima maior brasileira: "7M" ou "7+" (e "7m" digitado em minúsculas,
  // já que ninguém escreve menor com sétima como "C7m" — esse é "Cm7").
  s = s.replace(/^m7[M+]$/, 'mMaj7').replace(/^m7M/, 'mMaj7')
  s = s.replace(/^7[Mm+]/, 'maj7')

  // Aumentado: "+", "5+", "#5" sozinhos.
  if (/^(\+|5\+|\+5|#5)$/.test(s)) s = 'aug'
  // "sus" sozinho é sus4.
  if (/^sus$/i.test(s)) s = 'sus4'
  // Menor em minúsculas: "min" -> "m".
  s = s.replace(/^min(?!or)/i, 'm')
  // Minúsculas em palavras que o tonal espera em outro formato.
  s = s.replace(/^maj/i, 'maj').replace(/^dim/i, 'dim').replace(/^aug/i, 'aug').replace(/sus/i, 'sus').replace(/add/i, 'add')
  return s
}

export function parseChord(input: string): ParseResult {
  const text = input.trim().replace(/\s+/g, '')
  if (!text) return { ok: false, error: 'Digite um acorde, por exemplo C, Am7 ou F#7M.' }

  const m = text.match(ROOT_RE)
  if (!m) {
    return { ok: false, error: `"${input.trim()}" não começa com uma nota (A a G).` }
  }
  const root = m[1].toUpperCase() + (m[2] ? m[2].replace('♯', '#').replace('♭', 'b').toLowerCase() : '')
  if (!Note.get(root).name) return { ok: false, error: `Não reconheci a nota "${root}".` }

  // Inversão escrita com barra (C/E, Am/C, G7/B): o acorde antes da barra e
  // a nota do baixo depois. O baixo precisa ser uma nota do acorde.
  let bass: string | undefined
  if (m[3].includes('/')) {
    const cut = m[3].indexOf('/')
    const b = m[3].slice(cut + 1).match(/^([a-g])([#♯]|b|♭)?$/i)
    if (!b) return { ok: false, error: `Não reconheci a nota do baixo em "${text}". Exemplo: C/E, Am/C, G7/B.` }
    bass = b[1].toUpperCase() + (b[2] ? b[2].replace('♯', '#').replace('♭', 'b').toLowerCase() : '')
    m[3] = m[3].slice(0, cut)
  }
  const suffix = translateSuffix(m[3])
  const chord = Chord.get(root + suffix)
  if (chord.empty) {
    return {
      ok: false,
      error: `Entendi a tônica ${root}, mas não reconheci "${m[3]}". Tente algo como ${root}m, ${root}7, ${root}7M, ${root}m7(b5), ${root}°, ${root}+ ou ${root}sus4.`,
    }
  }
  const quality = qualityOfTonalChord(chord.intervals)
  if (!quality) {
    return {
      ok: false,
      error: `O acorde ${root + m[3]} existe (${chord.name || chord.symbol}), mas ainda não tenho formas dele no banco.`,
    }
  }
  const ref: ChordRef = { root, quality }
  if (shapesFor(ref).length === 0) {
    return { ok: false, error: `Não há formas de ${chordDisplayName(ref)} no banco de acordes.` }
  }
  if (bass) {
    const tone = chord.notes.find((n) => Note.chroma(n) === Note.chroma(bass))
    if (!tone) {
      return {
        ok: false,
        error: `${bass} não é nota de ${chordDisplayName(ref)} (${chord.notes.join(' – ')}). Acordes com baixo de fora do acorde ainda não estão no app.`,
      }
    }
    return { ok: true, chord: ref, bass: tone }
  }
  return { ok: true, chord: ref }
}

// Sugestões de autocompletar: combinamos a tônica digitada (ou todas) com as
// qualidades cujo nome brasileiro ou internacional começa pelo que foi digitado.
export function suggest(input: string, limit = 8): ChordRef[] {
  const text = input.trim().replace(/\s+/g, '')
  if (!text) return []
  const m = text.match(ROOT_RE)
  if (!m) return []
  const letter = m[1].toUpperCase()
  const acc = m[2] ? m[2].replace('♯', '#').replace('♭', 'b').toLowerCase() : ''
  const rest = m[3].toLowerCase()

  // Sem acidente digitado, "A" também sugere "Ab"; a natural vem primeiro.
  const roots = ROOTS.map((r) => r.name)
    .filter((n) => (acc ? Note.chroma(n) === Note.chroma(letter + acc) : n[0] === letter))
    .sort((a, b) => a.length - b.length)
  const rootName = (n: string) => (acc ? letter + acc : n)

  const out: ChordRef[] = []
  for (const r of roots) {
    for (const q of QUALITIES) {
      const br = q.br.toLowerCase()
      const intl = q.tonal.toLowerCase()
      if (rest === '' || br.startsWith(rest) || intl.startsWith(rest) || translateSuffix(m[3]).toLowerCase() === intl) {
        out.push({ root: rootName(r), quality: q })
      }
    }
  }
  return out.slice(0, limit)
}
