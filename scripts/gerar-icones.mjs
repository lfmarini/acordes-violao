// Gera os ícones do PWA (192, 512 e maskable 512) a partir de um SVG.
// Rode com: node scripts/gerar-icones.mjs
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'

// Desenho: um mini diagrama de acorde (Am) com as cores dos graus.
function art({ pad }) {
  const s = 512
  const inner = s - pad * 2
  const x0 = pad + inner * 0.2
  const gap = (inner * 0.6) / 5
  const y0 = pad + inner * 0.26
  const fg = (inner * 0.56) / 4
  const strings = Array.from({ length: 6 }, (_, i) =>
    `<line x1="${x0 + i * gap}" y1="${y0}" x2="${x0 + i * gap}" y2="${y0 + fg * 4}" stroke="#e3e8f0" stroke-width="${7 - i * 0.8}" stroke-opacity="0.9"/>`).join('')
  const frets = Array.from({ length: 5 }, (_, k) =>
    `<line x1="${x0 - 8}" y1="${y0 + k * fg}" x2="${x0 + 5 * gap + 8}" y2="${y0 + k * fg}" stroke="${k === 0 ? '#f3efe6' : '#8a93a8'}" stroke-width="${k === 0 ? 16 : 5}"/>`).join('')
  const dot = (i, f, c) => `<circle cx="${x0 + i * gap}" cy="${y0 + (f - 0.5) * fg}" r="${gap * 0.42}" fill="${c}"/>`
  const dots = dot(3, 2, '#ff5c6c') + dot(2, 2, '#3ecbff') + dot(4, 1, '#ffc542')
  const r = gap * 0.3
  const xo = y0 - gap * 0.75
  const x = (i) => `<g stroke="#ff6b6b" stroke-width="9" stroke-linecap="round"><line x1="${x0 + i * gap - r}" y1="${xo - r}" x2="${x0 + i * gap + r}" y2="${xo + r}"/><line x1="${x0 + i * gap - r}" y1="${xo + r}" x2="${x0 + i * gap + r}" y2="${xo - r}"/></g>`
  const o = (i, c) => `<circle cx="${x0 + i * gap}" cy="${xo}" r="${r}" fill="none" stroke="${c}" stroke-width="9"/>`
  return strings + frets + dots + x(0) + o(1, '#ff5c6c') + o(5, '#3ecbff')
}

const bg = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1a1440"/><stop offset="1" stop-color="#05060a"/></linearGradient></defs>`
const normal = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}<rect width="512" height="512" rx="112" fill="url(#g)"/>${art({ pad: 40 })}</svg>`
// Maskable: fundo ocupa tudo e o desenho fica na "zona segura" central.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}<rect width="512" height="512" fill="url(#g)"/>${art({ pad: 96 })}</svg>`

writeFileSync('public/favicon.svg', normal)
await sharp(Buffer.from(normal)).resize(192, 192).png().toFile('public/pwa-192x192.png')
await sharp(Buffer.from(normal)).resize(512, 512).png().toFile('public/pwa-512x512.png')
await sharp(Buffer.from(maskable)).resize(512, 512).png().toFile('public/maskable-512x512.png')
await sharp(Buffer.from(maskable)).resize(180, 180).png().toFile('public/apple-touch-icon.png')
console.log('ícones gerados')
