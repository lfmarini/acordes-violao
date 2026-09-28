import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readChordMidi, type ChordTrack } from '../lib/chordMidi'
import { fmtDuration, parseLrc, plainLines, searchLrclib, type LrclibTrack } from '../lib/lrclib'
import { canPickFolder, guessSong, isMidiName, isTabName, latestFromDownloads, matchScore, takeSharedFiles } from '../lib/midiImport'
import { parsePastedChords, trackFromPaste } from '../lib/pasteChords'
import { assemble, chordAt, newSong, nextChord, type ChordSource, type MeasureChord, type Song } from '../lib/song'
import { useChordAnalysis } from '../lib/useChordAnalysis'
import { useKaraokeRecording, type RecFormat } from '../lib/useKaraokeRecording'
import { AlternativesPanel } from './AlternativesPanel'
import { RecordButton, RecordingPanel } from './RecordingPanel'
import { deleteSong, getSong, listSongs, putSong } from '../lib/songDb'
import { searchUrl, youtubeId } from '../lib/songLinks'
import { SongPlayer, type PatternId, type PlayPos, type PlayState, type SoundSource } from '../lib/songPlayer'
import { useStoredState } from '../lib/storage'
import { KaraokeBar } from './KaraokeBar'
import { SongSheet } from './SongSheet'
import { TempoPanel } from './TempoPanel'
import { VideoPanel } from './VideoPanel'

// ---------------------------------------------------------------------------
// Aba "Musik player": você busca a música (letra do LRCLIB), traz o MIDI de
// acordes do Chordify e o app monta sozinho a página de karaokê com a letra
// em blocos de compasso. Tudo fica salvo no aparelho (IndexedDB).
// ---------------------------------------------------------------------------

// Arquivo importado esperando saber de qual música é: MIDI de acordes ou tablatura.
type Pending = { kind: 'midi'; file: File; bytes: ArrayBuffer; track: ChordTrack } | { kind: 'tab'; file: File; bytes: ArrayBuffer }

// A tela da tablatura usa o alphaTab (grande): só é baixada quando precisa.
const TabSettings = lazy(() => import('./TabSettings'))

export function MusikPlayer({ active }: { active: boolean }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LrclibTrack[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [library, setLibrary] = useState<Song[]>([])
  const [song, setSong] = useState<Song | null>(null)
  const [openId, setOpenId] = useStoredState<string | null>('musik-aberta', null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // Sempre remonta ao abrir: assim melhorias na montagem valem também para as músicas já salvas.
  const sheet = useMemo(() => (song ? assemble(song) : null), [song])

  // --- Karaokê ------------------------------------------------------------------
  const [player] = useState(() => new SongPlayer())
  const [now, setNow] = useState<PlayPos | null>(null)
  const [playState, setPlayState] = useState<PlayState>('stopped')
  const [hasPlayer, setHasPlayer] = useState(false)
  const [wanted, setSource] = useStoredState<SoundSource>('musik-fonte', 'youtube')
  const [rate, setRate] = useStoredState('musik-velocidade', 1)
  const [metronome, setMetronome] = useStoredState('musik-metronomo', false)
  const [pattern, setPattern] = useStoredState<PatternId>('musik-batida', 'pop')
  const hasChords = !!sheet?.chordsInOrder.length
  const available: Record<SoundSource, boolean> = { youtube: !!song?.youtube && hasPlayer, midi: hasChords, acomp: hasChords, silent: true }
  // A fonte escolhida, ou a melhor disponível (a ordem da lista é a prioridade).
  const source: SoundSource = available[wanted] ? wanted : (['youtube', 'midi', 'acomp', 'silent'] as const).find((s) => available[s])!

  const recorder = useKaraokeRecording(player, song?.title ?? '')
  const [recFormat, setRecFormat] = useStoredState<RecFormat>('formato-gravacao', 'mp3')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    player.onPos = setNow
    player.onState = (s) => {
      setPlayState(s)
      if (s === 'playing') setNotice('')
    }
    player.onNotice = setNotice
    return () => player.destroy()
  }, [player])
  useEffect(() => {
    if (sheet) player.setSheet(sheet)
  }, [player, sheet])
  useEffect(() => {
    player.setOptions({ source, rate, metronome, pattern, countIn: song?.countIn ?? 0, bpm: sheet?.bpm ?? 90 })
  }, [player, source, rate, metronome, pattern, song?.countIn, sheet?.bpm])
  // Trocou de música: para. Saiu da aba: pausa.
  useEffect(() => player.stop(), [player, song?.id])
  useEffect(() => {
    if (!active) player.pause()
  }, [player, active])

  // --- Alternativas sem MIDI (áudio, microfone, cifra colada) ----------------------
  const songRef = useRef(song)
  useEffect(() => {
    songRef.current = song
  })
  const setChords = (track: ChordTrack, source: ChordSource, note?: string) => {
    const s = songRef.current
    if (!s) return
    void save({ ...s, track, source, autoTrack: undefined, measureEdits: {}, downbeatShift: 0 })
    const what = { audio: 'a análise do áudio', mic: 'o que o microfone ouviu', manual: 'a cifra colada' }[source as 'audio'] ?? 'o MIDI'
    setMessage({ kind: 'ok', text: `Acordes montados com ${what}. ${note ?? ''} Revise em "Editar compassos".` })
  }
  const analysis = useChordAnalysis(setChords)
  const replaceOk = () => !songRef.current?.track || confirm('Esta música já tem acordes. Substituir pelos novos?')

  const refresh = useCallback(() => listSongs().then(setLibrary).catch(() => setLibrary([])), [])

  // Abre a última música vista e carrega a lista das salvas.
  useEffect(() => {
    void refresh()
    if (openId) void getSong(openId).then((s) => s && setSong(s))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Salva a música (remontando a folha) e mostra. */
  const save = useCallback(
    async (next: Song) => {
      const withSheet = { ...next, sheet: assemble(next), updatedAt: Date.now() }
      setSong(withSheet)
      setOpenId(withSheet.id)
      await putSong(withSheet).catch(() => setMessage({ kind: 'error', text: 'Não consegui salvar no aparelho (armazenamento cheio ou bloqueado).' }))
      void refresh()
    },
    [refresh, setOpenId],
  )
  const update = (patch: Partial<Song>) => song && void save({ ...song, ...patch })

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setMessage(null)
    try {
      setResults(await searchLrclib(query))
    } catch {
      setResults(null)
      setMessage({ kind: 'error', text: 'Não consegui buscar no LRCLIB. Confira a internet (as músicas já salvas continuam abrindo offline).' })
    } finally {
      setSearching(false)
    }
  }

  const choose = async (t: LrclibTrack) => {
    const id = `lrclib-${t.id}`
    const saved = await getSong(id).catch(() => undefined)
    setResults(null)
    if (saved) return void save(saved)
    const synced = !!t.syncedLyrics
    const lyrics = t.syncedLyrics ? parseLrc(t.syncedLyrics) : t.plainLyrics ? plainLines(t.plainLyrics) : []
    await save(newSong({ id, lrclibId: t.id, title: t.trackName, artist: t.artistName, album: t.albumName ?? '', duration: t.duration, lyrics, synced }))
  }

  // --- Importação do MIDI e da tablatura ------------------------------------------------
  const attach = async (target: Song, p: Pending) => {
    setPending(null)
    if (p.kind === 'tab') {
      await save({ ...target, tab: { name: p.file.name, bytes: p.bytes, shifts: {} } })
      setMessage({ kind: 'ok', text: `Tablatura "${p.file.name}" ligada a "${target.title}". Ela aparece nos trechos INTRO, SOLO e FINAL.` })
      return
    }
    await save({ ...target, midi: p.bytes, midiName: p.file.name, track: p.track, source: 'midi', measureEdits: {}, downbeatShift: 0 })
    setMessage({ kind: 'ok', text: `Acordes de "${p.file.name}" ligados a "${target.title}".` })
  }

  const importFile = async (file: File) => {
    setMessage(null)
    if (isTabName(file.name)) {
      let p: Pending
      try {
        const bytes = await file.arrayBuffer()
        const { loadTab } = await import('../lib/tabScore') // confere se o arquivo abre
        loadTab(bytes)
        p = { kind: 'tab', file, bytes }
      } catch {
        setMessage({ kind: 'error', text: `Não consegui ler a tablatura "${file.name}". Ela pode estar danificada ou numa versão que o leitor não conhece.` })
        return
      }
      return pickSongFor(p)
    }
    if (!isMidiName(file.name) && !/midi/.test(file.type)) {
      // Arquivo de áudio: analisa para a música aberta.
      if (file.type.startsWith('audio/') || /\.(mp3|m4a|ogg|oga|wav|flac|aac)$/i.test(file.name)) {
        if (!songRef.current) return setMessage({ kind: 'error', text: 'Abra a música primeiro; depois envie o áudio para analisar.' })
        if (replaceOk()) void analysis.analyzeFile(file)
        return
      }
      setMessage({ kind: 'error', text: `"${file.name}" não é um MIDI (.mid), uma tablatura (.gp, .musicxml) nem um arquivo de áudio.` })
      return
    }
    let p: Pending
    try {
      const bytes = await file.arrayBuffer()
      p = { kind: 'midi', file, bytes, track: readChordMidi(bytes) }
    } catch (err) {
      setMessage({ kind: 'error', text: `Não consegui ler "${file.name}": ${err instanceof Error ? err.message : 'arquivo inválido'}.` })
      return
    }
    pickSongFor(p)
  }

  // Pelo nome do arquivo: a música aberta, ou alguma da biblioteca; senão, pergunta.
  const pickSongFor = (p: Pending) => {
    if (song && matchScore(p.file.name, song) >= 0.6) return attach(song, p)
    const guess = song ? null : guessSong(p.file.name, library)
    if (guess) return attach(guess, p)
    setPending(p)
  }

  const fromDownloads = async () => {
    try {
      const f = await latestFromDownloads()
      if (f) await importFile(f)
      else setMessage({ kind: 'error', text: 'Não achei nenhum MIDI (.mid) nem tablatura (.gp, .musicxml) nessa pasta.' })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setMessage({ kind: 'error', text: 'Não consegui abrir a pasta. Use "Escolher arquivo".' })
    }
  }

  // Arquivos vindos do "Compartilhar" do celular.
  useEffect(() => {
    if (!active || !new URLSearchParams(location.search).has('compartilhado')) return
    history.replaceState(null, '', location.pathname)
    void takeSharedFiles().then((files) => files.forEach((f) => void importFile(f)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const q = song ? `${song.artist} ${song.title}` : query

  // No replay da gravação, os blocos seguem o que foi anotado durante a gravação.
  const shown = recorder.replayUrl ? recorder.replayPos : now
  const current = shown && sheet ? chordAt(sheet.measures[shown.measure], shown.beat) : null
  const upcoming = shown && sheet ? nextChord(sheet, shown.measure, shown.beat) : (sheet?.chordsInOrder[0] ?? null)
  const sectionLabel =
    (shown &&
      sheet?.sections.find((s) => (s.lines.length ? s.lines.flatMap((l) => l.measures) : s.measures).some((m) => m.index === shown.measure))
        ?.label) ||
    ''

  return (
    <div
      className={`relative flex flex-col gap-4 ${song ? 'pb-36' : ''}`}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files[0]
        if (f) void importFile(f)
      }}
    >
      {dragging && (
        <div className="pointer-events-none fixed inset-4 z-50 grid place-items-center rounded-3xl border-4 border-dashed border-accent-2 bg-ink/80 font-display text-2xl font-bold text-accent-2">
          Solte o MIDI aqui
        </div>
      )}

      {/* Busca */}
      <section className="rounded-2xl border border-line bg-panel/80 p-3 backdrop-blur sm:p-6">
        <form onSubmit={search} className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Artista e música (ex.: Pearl Jam Last Kiss)"
            aria-label="Buscar música"
            className="min-w-0 flex-1 rounded-xl border border-line bg-ink/60 px-3 py-2.5 text-base outline-none focus:border-accent-2"
          />
          <button type="submit" disabled={searching || !query.trim()} className="btn btn-primary btn-round px-5">
            {searching ? 'Buscando…' : 'Buscar'}
          </button>
        </form>
        {message && (
          <p className={`mt-2 text-sm ${message.kind === 'error' ? 'text-rose-300' : 'text-emerald-300'}`} role="status">
            {message.text}
          </p>
        )}

        {results && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
              <span>{results.length ? 'Escolha a versão certa (confira a duração):' : 'Nada encontrado no LRCLIB.'}</span>
              <button onClick={() => setResults(null)} className="hover:text-white">
                fechar
              </button>
            </div>
            <ul className="flex max-h-[50dvh] flex-col gap-1.5 overflow-y-auto">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => void choose(r)}
                    className="flex w-full items-center gap-3 rounded-xl border border-line bg-ink/40 px-3 py-2 text-left hover:border-accent-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.trackName}</span>
                      <span className="block truncate text-xs text-slate-400">
                        {r.artistName}
                        {r.albumName ? ` · ${r.albumName}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="font-display text-lg font-bold tabular-nums">{fmtDuration(r.duration)}</span>
                      <span className="text-[10px] text-slate-400">
                        {r.instrumental ? 'instrumental' : r.syncedLyrics ? 'letra com tempo' : r.plainLyrics ? 'letra sem tempo' : 'sem letra'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {library.length > 0 && !results && (
          <details className="mt-3 text-sm" open={!song}>
            <summary className="cursor-pointer text-slate-400">Minhas músicas ({library.length}) — abrem sem internet</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {library.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <button
                    onClick={() => void save(s)}
                    className={`min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left hover:bg-white/5 ${song?.id === s.id ? 'text-accent-2' : ''}`}
                  >
                    {s.title} <span className="text-slate-500">· {s.artist}</span>
                    {s.track && <span className="ml-2 text-[10px] text-emerald-300">♪ acordes</span>}
                  </button>
                  <button
                    onClick={() => {
                      if (!confirm(`Apagar "${s.title}" do aparelho?`)) return
                      void deleteSong(s.id).then(refresh)
                      if (song?.id === s.id) {
                        setSong(null)
                        setOpenId(null)
                      }
                    }}
                    aria-label={`Apagar ${s.title}`}
                    className="rounded px-2 text-slate-500 hover:text-rose-300"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* A qual música pertence o arquivo (MIDI ou tablatura)? */}
      {pending && (
        <section className="rounded-2xl border border-accent-2/60 bg-panel/90 p-3 backdrop-blur sm:p-6" role="dialog" aria-label="Escolher a música do MIDI">
          <p className="mb-2 text-sm">
            A qual música pertence <strong>{pending.file.name}</strong>?
          </p>
          <div className="flex flex-wrap gap-2">
            {(song ? [song, ...library.filter((s) => s.id !== song.id)] : library).map((s) => (
              <button key={s.id} onClick={() => void attach(s, pending)} className="btn px-3 py-1.5 text-sm">
                {s.title} <span className="text-xs font-normal text-slate-400">{s.artist}</span>
              </button>
            ))}
            {!library.length && !song && <span className="text-sm text-slate-400">Busque e abra a música primeiro; depois importe o MIDI.</span>}
            <button onClick={() => setPending(null)} className="btn px-3 py-1.5 text-sm">
              Cancelar
            </button>
          </div>
        </section>
      )}

      {song && sheet && (
        <>
          {/* Cabeçalho */}
          <section className="rounded-2xl border border-line bg-panel/80 p-3 backdrop-blur sm:p-6">
            <h2 className="font-display text-3xl leading-tight font-bold">{song.title}</h2>
            <p className="text-slate-400">
              {song.artist}
              {song.album ? ` · ${song.album}` : ''}
            </p>
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <Info label="Tom" value={sheet.key?.name ?? '—'} />
              <Info label="BPM" value={song.track ? String(Math.round(sheet.bpm)) : '—'} />
              <Info label="Compasso" value={song.track ? `${sheet.beatsPerBar}/${song.track.beatUnit}` : '—'} />
              <div className="flex items-center gap-1.5">
                <dt className="text-slate-400">Capotraste</dt>
                <button onClick={() => update({ capo: Math.max(0, song.capo - 1) })} className="btn btn-round h-7 w-7 p-0" aria-label="Capotraste uma casa abaixo">
                  −
                </button>
                <dd className="w-14 text-center font-display font-bold">{song.capo ? `${song.capo}ª casa` : 'sem'}</dd>
                <button onClick={() => update({ capo: Math.min(12, song.capo + 1) })} className="btn btn-round h-7 w-7 p-0" aria-label="Capotraste uma casa acima">
                  +
                </button>
              </div>
              <Info label="Duração" value={fmtDuration(song.duration)} />
            </dl>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <ExtLink href={searchUrl.chordify(q)}>Abrir no Chordify</ExtLink>
              <ExtLink href={searchUrl.songsterr(q)}>Abrir no Songsterr</ExtLink>
              <ExtLink href={searchUrl.cifraclub(q)}>Abrir no Cifra Club</ExtLink>
              <ExtLink href={song.youtube ? `https://www.youtube.com/watch?v=${song.youtube}` : searchUrl.youtube(q)}>Ver no YouTube</ExtLink>
            </div>
          </section>

          <VideoPanel
            videoId={song.youtube}
            query={q}
            onPlayer={(yt) => {
              player.setYouTube(yt)
              setHasPlayer(!!yt)
            }}
            onState={(s) => player.ytStateChanged(s)}
          />

          {/* Acordes: importar o MIDI do Chordify */}
          <section className="rounded-2xl border border-line bg-panel/80 p-3 backdrop-blur sm:p-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-lg font-bold">Acordes (MIDI do Chordify)</h3>
              <span className={`text-xs ${song.track ? 'text-emerald-300' : 'text-slate-400'}`}>
                {song.track ? `✔ ${song.midiName ?? 'MIDI importado'}` : 'nenhum MIDI ainda'}
              </span>
            </div>
            <ol className="mb-3 list-decimal space-y-0.5 pl-5 text-sm text-slate-300">
              <li>
                Toque em <strong>Abrir no Chordify</strong>, escolha a mesma gravação e baixe o <strong>MIDI</strong> na versão{' '}
                <em>time aligned</em> (alinhada ao tempo).
              </li>
              <li>
                Traga o arquivo: no celular, <strong>Compartilhar → Acordes</strong>; no computador, o botão da pasta Downloads, arrastar
                e soltar aqui ou escolher o arquivo.
              </li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <a href={searchUrl.chordify(q)} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-round px-4">
                Abrir no Chordify ↗
              </a>
              {canPickFolder() && (
                <button onClick={() => void fromDownloads()} className="btn btn-round px-4">
                  ⬇ Pegar último arquivo da pasta Downloads
                </button>
              )}
              <button onClick={() => fileInput.current?.click()} className="btn btn-round px-4">
                Escolher arquivo
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".mid,.midi,audio/midi,audio/x-midi,.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.mxl"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void importFile(f)
                }}
              />
            </div>
            <YoutubeField value={song.youtube} onSave={(id) => update({ youtube: id ?? undefined })} />
            <AlternativesPanel
              busy={analysis.busy}
              error={analysis.error}
              mic={analysis.mic}
              onFile={(f) => replaceOk() && void analysis.analyzeFile(f)}
              onMicStart={() => {
                if (!replaceOk()) return
                player.pause() // o som do app não pode entrar no microfone
                void analysis.startMic()
              }}
              onMicStop={(go) => void analysis.stopMic(go)}
              onCancel={analysis.cancel}
              onPaste={(text) => {
                const pasted = parsePastedChords(text)
                if (!pasted.some((l) => l.chords.length)) return 'Não encontrei acordes nessa cifra.'
                if (!replaceOk()) return null
                setChords(trackFromPaste(song, pasted, sheet.bpm, sheet.beatsPerBar), 'manual')
                return null
              }}
            />
          </section>

          {/* Tablatura/partitura dos trechos INTRO, SOLO e FINAL */}
          <section className="rounded-2xl border border-line bg-panel/80 p-3 backdrop-blur sm:p-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-lg font-bold">Tablatura (riff e solo)</h3>
              <span className={`text-xs ${song.tab ? 'text-emerald-300' : 'text-slate-400'}`}>{song.tab ? `✔ ${song.tab.name}` : 'nenhuma ainda'}</span>
            </div>
            {song.tab ? (
              <Suspense fallback={<p className="text-sm text-slate-400">Abrindo a tablatura…</p>}>
                <TabSettings tab={song.tab} sheet={sheet} onChange={(tab) => update({ tab })} />
              </Suspense>
            ) : (
              <>
                <p className="text-sm text-slate-300">
                  Traga um arquivo <strong>Guitar Pro</strong> (.gp, .gp5, .gpx) ou <strong>MusicXML</strong> da música, de um site onde você tenha
                  direito de baixar. Pelo mesmo caminho do MIDI: Compartilhar → Acordes, pasta Downloads, arrastar ou "Escolher arquivo". O app
                  escolhe a faixa da guitarra e encaixa a tablatura nos trechos INTRO, SOLO e FINAL sozinho.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <a href={searchUrl.ultimateGuitar(q)} target="_blank" rel="noopener noreferrer" className="btn btn-round px-3 py-1.5 text-xs">
                    Procurar no Ultimate Guitar ↗
                  </a>
                  <button onClick={() => fileInput.current?.click()} className="btn btn-round px-3 py-1.5 text-xs">
                    Escolher arquivo
                  </button>
                </div>
              </>
            )}
          </section>

          <TempoPanel song={song} sheet={sheet} player={player} hasVideo={available.youtube} onChange={update} />

          {song.lyrics.length === 0 && (
            <p className="text-sm text-slate-400">Esta versão não tem letra no LRCLIB (instrumental). Aparecem só os compassos.</p>
          )}
          {!song.synced && song.lyrics.length > 0 && (
            <p className="text-sm text-slate-400">Esta letra não tem o tempo de cada linha: as linhas foram espalhadas pelos acordes.</p>
          )}

          <SongSheet
            song={song}
            sheet={sheet}
            now={shown}
            onSeek={(i) => {
              recorder.closeReplay()
              player.seekMeasure(i)
            }}
            onEditMeasure={(index, chords: MeasureChord[] | null) => {
              const edits = { ...song.measureEdits }
              if (chords) edits[index] = chords
              else delete edits[index]
              update({ measureEdits: edits })
            }}
            onShiftDownbeat={(d) => {
              if (Object.keys(song.measureEdits).length && !confirm('Mudar a divisão dos compassos desfaz as correções de acordes. Continuar?')) return
              update({ downbeatShift: song.downbeatShift + d, measureEdits: {} })
            }}
          />

          <KaraokeBar
            state={playState}
            current={current}
            next={upcoming}
            label={sectionLabel}
            source={source}
            available={available}
            rate={rate}
            metronome={metronome}
            pattern={pattern}
            onPlay={() => {
              recorder.closeReplay()
              void player.play()
            }}
            onPause={() => player.pause()}
            onStop={() => player.stop()}
            onSection={() => player.sectionStart()}
            onRate={setRate}
            onMetronome={setMetronome}
            onSource={setSource}
            onPattern={setPattern}
            above={
              <>
                {notice && (
                  <p role="status" className="rounded-xl border border-amber-300/50 bg-panel/95 px-3 py-2 text-sm text-amber-200 shadow-lg">
                    {notice}
                    <button onClick={() => setNotice('')} className="ml-2 text-xs text-slate-400 underline">
                      ok
                    </button>
                  </p>
                )}
                <RecordingPanel rec={recorder} format={recFormat} onFormat={setRecFormat} />
              </>
            }
          >
            <RecordButton rec={recorder} />
          </KaraokeBar>
        </>
      )}

      {!song && !results && (
        <p className="px-1 text-sm text-slate-400">
          Digite o artista e o nome da música. O app busca a letra com o tempo de cada linha e, com o MIDI de acordes do Chordify, monta a
          página de karaokê em blocos de compasso.
        </p>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-display font-bold">{value}</dd>
    </div>
  )
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="btn btn-round px-3 py-1.5 text-xs">
      {children} ↗
    </a>
  )
}

function YoutubeField({ value, onSave }: { value?: string; onSave: (id: string | null) => void }) {
  const [text, setText] = useState(value ? `https://youtu.be/${value}` : '')
  const [error, setError] = useState(false)
  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        const id = text.trim() ? youtubeId(text) : null
        setError(!!text.trim() && !id)
        if (!text.trim() || id) onSave(id)
      }}
    >
      <label htmlFor="yt" className="w-full text-slate-400 sm:w-auto">
        Link do YouTube usado pelo Chordify:
      </label>
      <input
        id="yt"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="https://youtu.be/…"
        className="min-w-0 flex-1 rounded-lg border border-line bg-ink/60 px-2 py-1.5 outline-none focus:border-accent-2"
      />
      <button type="submit" className="btn btn-round px-3 py-1.5 text-xs">
        {value ? 'Atualizar' : 'Salvar'}
      </button>
      {value && <span className="text-xs text-emerald-300">✔ vídeo salvo</span>}
      {error && <span className="w-full text-xs text-rose-300">Não reconheci esse link do YouTube.</span>}
    </form>
  )
}
