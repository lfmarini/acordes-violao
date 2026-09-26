import { useEffect, useState } from 'react'

// Pausa o loop de renderização 3D quando a aba vai para o fundo (economiza
// bateria) e deixa a cena parada se o sistema pedir menos movimento.
export function useFrameloop(): 'always' | 'never' | 'demand' {
  const reduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  if (!visible) return 'never'
  return reduced ? 'demand' : 'always'
}

// devicePixelRatio limitado a 2 (telas de celular chegam a 3 ou 4).
export const DPR: [number, number] = [1, 2]
