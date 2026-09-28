import type { Song } from './song'

// ---------------------------------------------------------------------------
// Banco de dados do aparelho (IndexedDB) para a aba Musik player.
// O localStorage (usado no resto do app) é pequeno e só guarda texto; aqui
// guardamos músicas inteiras (letra, acordes, MIDI) e a permissão da pasta
// Downloads. Tudo fica só neste navegador e funciona offline.
// ---------------------------------------------------------------------------

const DB_NAME = 'acordes-musik'
const VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
  })
  return dbPromise
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(store, mode).objectStore(store))
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error)
      }),
  )
}

export const listSongs = () =>
  run<Song[]>('songs', 'readonly', (s) => s.getAll()).then((all) => all.sort((a, b) => b.updatedAt - a.updatedAt))
export const getSong = (id: string) => run<Song | undefined>('songs', 'readonly', (s) => s.get(id))
export const putSong = (song: Song) => run<IDBValidKey>('songs', 'readwrite', (s) => s.put({ ...song, updatedAt: Date.now() }))
export const deleteSong = (id: string) => run<undefined>('songs', 'readwrite', (s) => s.delete(id))

export const kvGet = <T>(key: string) => run<T | undefined>('kv', 'readonly', (s) => s.get(key))
export const kvSet = (key: string, value: unknown) => run<IDBValidKey>('kv', 'readwrite', (s) => s.put(value, key))
