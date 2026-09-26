// O JSON do banco de acordes é grande; declaramos o tipo à mão para o
// TypeScript não precisar analisar o arquivo inteiro.
declare module '@tombatossals/chords-db/lib/guitar.json' {
  const data: unknown
  export default data
}
