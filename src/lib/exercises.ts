// ---------------------------------------------------------------------------
// Exercícios de ritmo para a mão esquerda (aba Aprendizado → Treino de ritmo).
//
// Cada exercício é uma sequência de "passos". Um passo é um ataque: um dedo
// ("1") ou dois dedos juntos ("1+3", que contam como 1 ataque só). Os números
// são os dedos da mão esquerda: 1 indicador, 2 médio, 3 anelar, 4 mínimo.
//
// Para adicionar um exercício, acrescente uma linha em EXTRAS lá embaixo,
// por exemplo: seq('Meu exercício', '2143') ou seq('Pares', '1+2 3+4').
// ---------------------------------------------------------------------------

export interface Step {
  /** Dedos tocados juntos neste ataque. */
  fingers: number[]
  /** Corda relativa, nos exercícios que trocam de corda (spider). */
  string?: 'grave' | 'aguda'
}

export interface Exercise {
  id: string
  name: string
  group: string
  steps: Step[]
  /** Dica curta mostrada embaixo da sequência. */
  hint?: string
}

/**
 * Lê uma sequência escrita em texto. Sem espaços, cada algarismo é um passo
 * ("1234"). Com espaços, cada pedaço é um passo e "+" junta dedos ("1+3 2+4").
 */
export function parseSequence(text: string): Step[] {
  const parts = text.trim().includes(' ') ? text.trim().split(/\s+/) : [...text.trim()]
  return parts.map((p) => ({ fingers: p.split('+').map(Number).filter((n) => n >= 1 && n <= 4) })).filter((s) => s.fingers.length)
}

/** Texto de um passo: "1" ou "1+3". */
export const stepLabel = (s: Step) => s.fingers.join('+')

/** Texto da sequência inteira: "1 2 3 4" ou "1+3 · 2+4". */
export const sequenceLabel = (steps: Step[]) => steps.map(stepLabel).join(steps.some((s) => s.fingers.length > 1) ? ' · ' : ' ')

function seq(group: string, name: string, text: string, hint?: string): Exercise {
  return { id: `${group}:${text}`, name, group, steps: parseSequence(text), hint }
}

/** Todas as ordens possíveis dos dedos 1, 2, 3 e 4 (24), em ordem crescente. */
export function permutations(items = [1, 2, 3, 4]): number[][] {
  if (items.length <= 1) return [items]
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]))
}

const MAIN = ['1234', '1324', '1432', '1243']
const G_MAIN = 'Principais'
const G_PERM = 'Outras permutações de 1234'
const G_BACK = 'Ida e volta'
const G_SPIDER = 'Spider (entre cordas)'

const reverse = (s: string) => [...s].reverse().join('')

// Spider alternado: 1 e 2 numa corda, 3 e 4 na corda vizinha, alternando.
const spiderAlternating: Exercise = {
  id: `${G_SPIDER}:1g3a2g4a`,
  name: '1/3 · 2/4 alternado',
  group: G_SPIDER,
  steps: [
    { fingers: [1], string: 'grave' },
    { fingers: [3], string: 'aguda' },
    { fingers: [2], string: 'grave' },
    { fingers: [4], string: 'aguda' },
  ],
  hint: 'Dedos 1 e 2 na corda mais grave, 3 e 4 na corda vizinha (mais aguda).',
}

// Exercícios extras: acrescente aqui (veja o comentário no topo do arquivo).
const EXTRAS: Exercise[] = []

export const EXERCISES: Exercise[] = [
  ...MAIN.map((s) => seq(G_MAIN, s, s)),
  ...permutations()
    .map((p) => p.join(''))
    .filter((s) => !MAIN.includes(s))
    .map((s) => seq(G_PERM, s, s)),
  ...MAIN.map((s) => seq(G_BACK, `${s} → ${reverse(s)}`, s + reverse(s))),
  spiderAlternating,
  seq(G_SPIDER, '1+3 · 2+4 juntos', '1+3 2+4', 'Dois dedos juntos em cordas vizinhas; cada par conta como 1 ataque.'),
  seq(G_SPIDER, '1+2 · 3+4 juntos', '1+2 3+4', 'Dois dedos juntos em cordas vizinhas; cada par conta como 1 ataque.'),
  ...EXTRAS,
]

export const DEFAULT_EXERCISE = EXERCISES[0].id

export const findExercise = (id: string) => EXERCISES.find((e) => e.id === id) ?? EXERCISES[0]

/** Grupos na ordem em que aparecem, para o seletor. */
export function exerciseGroups() {
  const groups = new Map<string, Exercise[]>()
  for (const e of EXERCISES) groups.set(e.group, [...(groups.get(e.group) ?? []), e])
  return [...groups]
}
