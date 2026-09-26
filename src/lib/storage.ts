import { useCallback, useState } from 'react'

// Tudo que o app "lembra" (dedos ligados, canhoto, volume, favoritos...)
// fica no localStorage do navegador. Alguns navegadores bloqueiam o acesso
// (aba anônima, por exemplo), então toda leitura e escrita fica em try/catch:
// se falhar, o app simplesmente usa o valor padrão.

const PREFIX = 'acordes:'

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writeStored<T>(key: string, value: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // sem armazenamento disponível: segue sem lembrar
  }
}

export function useStoredState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readStored(key, fallback))
  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        writeStored(key, resolved)
        return resolved
      })
    },
    [key],
  )
  return [value, update] as const
}
