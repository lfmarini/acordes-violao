import { useRef, useState } from 'react'
import { parsePastedChords } from '../lib/pasteChords'
import type { Busy } from '../lib/useChordAnalysis'

// ---------------------------------------------------------------------------
// Alternativas quando não há MIDI do Chordify, em ordem de prioridade:
//  1. analisar um arquivo de áudio (Essentia.js, no próprio aparelho);
//  2. ouvir pelo microfone a música tocando em outro aparelho;
//  3. colar a cifra à mão (botão discreto).
// ---------------------------------------------------------------------------

interface Props {
  busy: Busy | null
  error: string
  mic: { seconds: number; db: number } | null
  onFile: (f: File) => void
  onMicStart: () => void
  onMicStop: (analyze: boolean) => void
  onCancel: () => void
  onPaste: (text: string) => string | null // devolve o erro, se houver
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function AlternativesPanel({ busy, error, mic, onFile, onMicStart, onMicStop, onCancel, onPaste }: Props) {
  const file = useRef<HTMLInputElement>(null)
  const [pasting, setPasting] = useState(false)
  const [text, setText] = useState('')
  const [pasteError, setPasteError] = useState('')
  const preview = text.trim() ? parsePastedChords(text) : []
  const found = preview.reduce((n, l) => n + l.chords.length, 0)

  return (
    <div className="mt-4 rounded-xl border border-line bg-black/20 p-3">
      <strong className="text-sm">Sem o MIDI do Chordify?</strong>

      {busy ? (
        <div className="mt-3" role="status" aria-live="polite">
          <div className="mb-1 flex justify-between text-xs text-slate-300">
            <span>{busy.stage}…</span>
            <span className="tabular-nums">{Math.round(busy.progress * 100)}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width]" style={{ width: `${Math.max(3, busy.progress * 100)}%` }} />
          </div>
          <button onClick={onCancel} className="btn btn-round mt-2 px-3 py-1 text-xs">
            Cancelar
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          {/* 1. Arquivo de áudio */}
          <div>
            <button onClick={() => file.current?.click()} disabled={!!mic} className="btn btn-round px-4">
              🎵 Analisar arquivo de áudio
            </button>
            <input
              ref={file}
              type="file"
              accept="audio/*,.mp3,.m4a,.ogg,.wav,.flac"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) onFile(f)
              }}
            />
            <p className="mt-1 text-xs text-slate-400">
              MP3, M4A ou OGG da mesma gravação. A análise roda no aparelho (nada é enviado) e acha BPM, batidas, tom e acordes.{' '}
              <span className="text-amber-200">Ela só reconhece acordes maiores e menores simples</span> (sem sétima, nona ou baixo trocado): revise
              depois em "Editar compassos".
            </p>
          </div>

          {/* 2. Microfone */}
          <div>
            {mic ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-2 text-sm tabular-nums">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" aria-hidden />
                  ouvindo {fmt(mic.seconds)}
                </span>
                <span className="h-2 w-24 overflow-hidden rounded-full bg-white/10" aria-label="Volume captado">
                  <span className="block h-full bg-accent-2" style={{ width: `${Math.max(0, (mic.db + 60) / 60) * 100}%` }} />
                </span>
                <button onClick={() => onMicStop(true)} className="btn btn-danger btn-round px-4">
                  ■ Parar e analisar
                </button>
                <button onClick={() => onMicStop(false)} className="text-xs text-slate-400 underline">
                  descartar
                </button>
              </div>
            ) : (
              <button onClick={onMicStart} className="btn btn-round px-4">
                🎤 Ouvir pelo microfone
              </button>
            )}
            <p className="mt-1 text-xs text-slate-400">
              Toque a música em outro aparelho, perto do microfone, e aperte o botão logo antes de ela começar. Usa a mesma gravação da aba
              Aprendizado (e a redução de ruído escolhida lá).{' '}
              <span className="text-amber-200">A precisão é menor que a do arquivo</span>; depois, acerte a letra no "Ajuste fino da letra".
            </p>
          </div>

          {/* 3. Colar cifra (discreto) */}
          {!pasting ? (
            <button onClick={() => setPasting(true)} className="self-start text-xs text-slate-400 underline hover:text-white">
              colar cifra manualmente
            </button>
          ) : (
            <div>
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setPasteError('')
                }}
                rows={8}
                spellCheck={false}
                placeholder={'Acorde sobre a letra:\nG            Em\nera uma vez uma canção\n\nou ChordPro:\n[G]era uma vez [Em]uma canção'}
                className="w-full rounded-lg border border-line bg-ink/60 p-2 font-mono text-sm outline-none focus:border-accent-2"
                aria-label="Cifra para colar"
              />
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>{text.trim() ? `${found} acordes em ${preview.length} linhas` : 'Cole a cifra acima.'}</span>
                <button
                  disabled={!found}
                  onClick={() => {
                    const err = onPaste(text)
                    if (err) setPasteError(err)
                    else setPasting(false)
                  }}
                  className="btn btn-primary btn-round ml-auto px-4 py-1 text-xs"
                >
                  Montar com esta cifra
                </button>
                <button onClick={() => setPasting(false)} className="btn btn-round px-3 py-1 text-xs">
                  Fechar
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Os acordes são colocados na hora em que cada linha é cantada (pela letra com tempo) ou, sem tempo, 2 compassos por linha no BPM
                da música. Depois use "Marcar tempo" para acertar.
              </p>
              {pasteError && <p className="mt-1 text-xs text-rose-300">{pasteError}</p>}
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
    </div>
  )
}
