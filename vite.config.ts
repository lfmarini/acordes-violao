import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Acordes Violão',
        short_name: 'Acordes',
        description: 'Estude acordes de violão: forma no braço, teoria de cada grau e som. Funciona offline.',
        lang: 'pt-BR',
        theme_color: '#05060a',
        background_color: '#05060a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // "Compartilhar → Acordes" no celular: recebe o MIDI do Chordify (ou um
        // áudio). Quem trata o envio é public/compartilhar-sw.js.
        share_target: {
          action: '/compartilhar',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [
              {
                name: 'arquivo',
                accept: ['audio/midi', 'audio/mid', 'audio/x-midi', 'application/x-midi', '.mid', '.midi', 'audio/*'],
              },
            ],
          },
        },
      },
      workbox: {
        importScripts: ['compartilhar-sw.js'],
        // Guarda TUDO (inclusive a parte 3D e o som, que é sintetizado) para
        // o app funcionar sem internet. As fontes não-latinas ficam de fora.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}', '**/*latin*.woff2'],
        globIgnores: ['**/*cyrillic*', '**/*greek*', '**/*vietnamese*'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  build: {
    // tone.js e three.js são grandes; o aviso padrão de 500 kB não ajuda aqui.
    chunkSizeWarningLimit: 1200,
  },
})
