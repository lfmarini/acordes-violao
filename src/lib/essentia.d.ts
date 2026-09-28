// Tipos mínimos dos arquivos do essentia.js que usamos (o pacote não traz tipos para eles).
declare module 'essentia.js/dist/essentia-wasm.es.js' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const EssentiaWASM: any
}
declare module 'essentia.js/dist/essentia.js-core.es.js' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Essentia: new (wasm: any) => any
  export default Essentia
}
