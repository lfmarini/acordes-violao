// Testes do treino de ritmo (aba Aprendizado). Rode com: npm run ritmo
import { EXERCISES, exerciseGroups, parseSequence, permutations, sequenceLabel } from '../src/lib/exercises'

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

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
