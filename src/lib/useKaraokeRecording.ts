import { useCallback, useEffect, useRef, useState } from 'react'
import type { NoiseLevel } from './denoise'
import { micErrorMessage, openMicrophone, type MicSession } from './microphone'
import { downloadBlob, recordingFileName, type Recorder } from './recorder'
import type { PlayPos, SongPlayer } from './songPlayer'
import { readStored } from './storage'

// ---------------------------------------------------------------------------
// Gravação no karaokê: você toca junto e o app grava pelo microfone (o
// mesmo módulo da aba Aprendizado). Enquanto grava, anotamos em que compasso
// e tempo o karaokê estava a cada instante; no replay, o horário do áudio
// consulta essas anotações e os blocos andam do mesmo jeito que andaram
// (mesmo com pausas, pulos ou mudança de velocidade).
// ---------------------------------------------------------------------------

type Mark = { at: number; pos: PlayPos | null } // at = performance.now()

export type RecFormat = 'mp3' | 'wav'

export function useKaraokeRecording(player: SongPlayer, title: string) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [replayUrl, setReplayUrl] = useState<string | null>(null)
  const [replayPos, setReplayPos] = useState<PlayPos | null>(null)
  const [saving, setSaving] = useState<number | null>(null)
  const mic = useRef<MicSession | null>(null)
  const rec = useRef<Recorder | null>(null)
  const marks = useRef<Mark[]>([])
  const raf = useRef(0)
  const audio = useRef<HTMLAudioElement | null>(null)

  const closeReplay = useCallback(() => {
    setReplayUrl((u) => {
      if (u) URL.revokeObjectURL(u)
      return null
    })
    setReplayPos(null)
  }, [])

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current)
    mic.current?.close()
    mic.current = null
    setRecording(false)
    setSeconds(rec.current?.seconds ?? 0)
  }, [])

  const start = useCallback(async () => {
    setError('')
    closeReplay()
    let m: MicSession
    try {
      m = await openMicrophone(readStored<NoiseLevel>('reducao-ruido', 'off'))
    } catch (e) {
      setError(micErrorMessage(e))
      return
    }
    if (!m.recorder) {
      m.close()
      setError('Este navegador não deixa gravar o microfone.')
      return
    }
    mic.current = m
    rec.current = m.recorder
    marks.current = []
    let lastKey = '?'
    let lastUi = 0
    const loop = (t: number) => {
      const pos = player.state === 'stopped' ? null : player.position()
      const key = pos ? `${pos.measure}:${pos.beat}` : ''
      if (key !== lastKey) {
        marks.current.push({ at: performance.now(), pos })
        lastKey = key
      }
      if (t - lastUi > 200) {
        setSeconds(m.recorder!.seconds)
        lastUi = t
      }
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
    setSeconds(0)
    setRecording(true)
  }, [player, closeReplay])

  /** Ouvir a gravação com os blocos andando junto. */
  const replay = useCallback(() => {
    if (recording) stop()
    const r = rec.current
    if (!r || r.seconds === 0) return
    player.pause()
    closeReplay()
    setReplayUrl(URL.createObjectURL(r.toWav()))
  }, [recording, stop, player, closeReplay])

  // Durante o replay: horário do áudio -> compasso anotado naquele instante.
  useEffect(() => {
    if (!replayUrl) return
    let id = 0
    let lastKey = '?'
    const tick = () => {
      const el = audio.current
      const r = rec.current
      if (el && r && marks.current.length) {
        const at = r.startTime + el.currentTime * 1000
        const list = marks.current
        let lo = 0
        let hi = list.length - 1
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1
          if (list[mid].at <= at) lo = mid
          else hi = mid - 1
        }
        const pos = list[lo].at <= at ? list[lo].pos : null
        const key = pos ? `${pos.measure}:${pos.beat}` : ''
        if (key !== lastKey) {
          lastKey = key
          setReplayPos(pos)
        }
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [replayUrl])

  const download = useCallback(
    async (format: RecFormat) => {
      const r = rec.current
      if (!r) return
      const name = recordingFileName(`${title || 'musica'}-karaoke`, 'gravacao', format)
      if (format === 'wav') return downloadBlob(r.toWav(), name)
      setSaving(0)
      try {
        downloadBlob(await r.toMp3(undefined, undefined, setSaving), name)
      } catch {
        setError('Não consegui converter para MP3. Tente WAV.')
      } finally {
        setSaving(null)
      }
    },
    [title],
  )

  // Saiu da página: desliga o microfone e libera o áudio.
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      mic.current?.close()
    },
    [],
  )

  /** Liga o elemento <audio> do replay (use como ref). */
  const setAudio = useCallback((el: HTMLAudioElement | null) => {
    audio.current = el
  }, [])

  return { recording, seconds, error, setError, replayUrl, replayPos, saving, setAudio, start, stop, replay, closeReplay, download, hasRecording: seconds > 0 }
}
