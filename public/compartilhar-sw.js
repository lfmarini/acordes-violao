// Parte do service worker que recebe arquivos do "Compartilhar" do celular
// (Web Share Target, ver "share_target" no manifesto em vite.config.ts).
// O arquivo (MIDI de acordes ou áudio) é guardado num cache e o app é aberto
// na aba Musik player, que o importa (src/lib/midiImport.ts).
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'POST' || url.pathname !== '/compartilhar') return
  event.respondWith(
    (async () => {
      const form = await event.request.formData()
      const cache = await caches.open('acordes-compartilhados')
      let i = 0
      for (const f of form.getAll('arquivo')) {
        if (typeof f === 'string') continue
        await cache.put(
          `/compartilhado/${Date.now()}-${i++}`,
          new Response(f, {
            headers: { 'content-type': f.type || 'application/octet-stream', 'x-nome': encodeURIComponent(f.name) },
          }),
        )
      }
      return Response.redirect('/?compartilhado=1', 303)
    })(),
  )
})
