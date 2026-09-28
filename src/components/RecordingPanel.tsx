import type { RecFormat } from '../lib/useKaraokeRecording'
import type { useKaraokeRecording } from '../lib/useKaraokeRecording'

// ---------------------------------------------------------------------------
// Gravação no karaokê: botão na barra de controle e um quadro logo acima dela
// para ouvir a gravação (com os blocos andando junto) e baixar o arquivo.
// ---------------------------------------------------------------------------

type Rec = ReturnType<typeof useKaraokeRecording>

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function RecordButton({ rec }: { rec: Rec }) {
  return (
    <button
      onClick={() => (rec.recording ? rec.stop() : void rec.start())}
      aria-pressed={rec.recording}
      aria-label={rec.recording ? 'Parar a gravação' : 'Gravar'}
      title={rec.recording ? 'Parar a gravação' : 'Gravar você tocando junto'}
      className={`btn btn-round h-12 min-w-12 gap-1 px-2 text-sm ${rec.recording ? 'btn-danger' : ''}`}
    >
      {rec.recording ? (
        <>
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" aria-hidden />
          <span className="tabular-nums">{fmt(rec.seconds)}</span>
        </>
      ) : (
        <span className="text-lg text-rose-400">●</span>
      )}
    </button>
  )
}

export function RecordingPanel({ rec, format, onFormat }: { rec: Rec; format: RecFormat; onFormat: (f: RecFormat) => void }) {
  const { replayUrl, setAudio, closeReplay } = rec
  if (rec.recording) {
    return (
      <div className="rounded-xl border border-rose-400/50 bg-panel/95 px-3 py-2 text-xs text-slate-300 shadow-lg">
        <strong className="text-rose-300">● Gravando {fmt(rec.seconds)}</strong> — toque ▶ e toque junto. Com fones de ouvido, a gravação
        pega só o seu violão.
      </div>
    )
  }
  if (!rec.hasRecording && !rec.error) return null
  return (
    <div className="rounded-xl border border-line bg-panel/95 p-2 text-sm shadow-lg">
      {rec.error ? (
        <p className="text-rose-300">
          {rec.error}{' '}
          <button onClick={() => rec.setError('')} className="text-xs text-slate-400 underline">
            ok
          </button>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Sua gravação · {fmt(rec.seconds)}</span>
            {!rec.replayUrl && (
              <button onClick={rec.replay} className="btn btn-primary btn-round px-3 py-1 text-xs">
                ▶ Ouvir com os blocos
              </button>
            )}
            <span className="ml-auto flex items-center gap-1" role="group" aria-label="Formato do arquivo">
              {(['mp3', 'wav'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => onFormat(f)}
                  aria-pressed={format === f}
                  className={`btn btn-round px-2 py-0.5 text-[11px] uppercase ${format === f ? 'btn-primary' : ''}`}
                >
                  {f}
                </button>
              ))}
              <button onClick={() => void rec.download(format)} disabled={rec.saving !== null} className="btn btn-round px-3 py-1 text-xs">
                {rec.saving !== null ? `Convertendo… ${Math.round(rec.saving * 100)}%` : '⬇ Baixar'}
              </button>
            </span>
          </div>
          {replayUrl && (
            <div className="mt-2 flex items-center gap-2">
              <audio ref={setAudio} key={replayUrl} src={replayUrl} controls autoPlay className="h-9 min-w-0 flex-1" />
              <button onClick={closeReplay} className="btn btn-round h-9 w-9 p-0 text-xs" aria-label="Fechar o replay">
                ✕
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
