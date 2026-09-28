import { useSyncExternalStore } from 'react'
import type { DegreeId } from './theory'
import { readStored, writeStored } from './storage'

// ---------------------------------------------------------------------------
// Temas de cores. Cada tema define:
//  - ui: as cores da interface (fundo, painéis, bordas, destaques, texto),
//    aplicadas como variáveis CSS que o Tailwind usa (bg-panel, text-accent...);
//  - degrees: a cor de cada grau do acorde (braço, painel de teoria, legenda);
//  - board: as cores do desenho do braço;
//  - chart: as cores do gráfico de amplitude;
//  - bg3d: as cores das formas do fundo animado.
// O tema claro também inverte a escala de cinzas e o branco/preto do
// Tailwind, para os textos continuarem legíveis sobre fundo claro.
// Neon é o padrão.
// ---------------------------------------------------------------------------

export type ThemeId = 'neon' | 'madeira' | 'oceano' | 'daltonico' | 'claro'

interface Dot {
  color: string
  ink: string // cor do número do dedo dentro do círculo
}

export interface Theme {
  id: ThemeId
  name: string
  hint: string
  light: boolean
  ui: { ink: string; panel: string; line: string; accent: string; accent2: string; text: string }
  degrees: Record<DegreeId, Dot>
  board: {
    wood: string
    inlay: string
    fret: string
    nut: string
    wound: string // cordas graves (bronze)
    plain: string // cordas agudas (aço)
    label: string
    sub: string
    neutral: string
    muted: string // cor do X
  }
  chart: { grid: string; axis: string; line: string; fill: [string, string, string]; beat: string; mark: string; playhead: string }
  bg3d: [string, string, string]
}

const d = (color: string, ink = '#111318'): Dot => ({ color, ink })

export const THEMES: Theme[] = [
  {
    id: 'neon',
    name: 'Neon',
    hint: 'roxo e ciano (padrão)',
    light: false,
    ui: { ink: '#05060a', panel: '#0d1019', line: '#1e2433', accent: '#7c5cff', accent2: '#22d3ee', text: '#e6e9f0' },
    degrees: {
      root: d('#ff5c6c'), third: d('#ffc542'), fifth: d('#3ecbff'), seventh: d('#b98cff'),
      ninth: d('#4ee38a'), fourth: d('#ff8ad8'), sixth: d('#ff9a3c'),
    },
    board: { wood: '#141824', inlay: '#262c3d', fret: '#8a93a8', nut: '#f3efe6', wound: '#d8c29a', plain: '#e3e8f0', label: '#e2e8f0', sub: '#94a3b8', neutral: '#e5e9f0', muted: '#ff6b6b' },
    chart: { grid: 'rgba(255,255,255,0.06)', axis: '#64748b', line: '#67e8f9', fill: ['rgba(255,92,108,0.9)', 'rgba(34,211,238,0.7)', 'rgba(34,211,238,0.05)'], beat: '124,92,255', mark: 'rgba(255,197,66,0.9)', playhead: '#ffffff' },
    bg3d: ['#7c5cff', '#22d3ee', '#ff5c6c'],
  },
  {
    id: 'madeira',
    name: 'Madeira',
    hint: 'tons quentes de violão',
    light: false,
    ui: { ink: '#0e0906', panel: '#1a120c', line: '#33251a', accent: '#d9822b', accent2: '#f2c078', text: '#f3e9dc' },
    degrees: {
      root: d('#ff6b4a'), third: d('#ffd166'), fifth: d('#5ec8c0'), seventh: d('#c79bff'),
      ninth: d('#9be37a'), fourth: d('#f28fb8'), sixth: d('#8fd3ff'),
    },
    board: { wood: '#2a1b10', inlay: '#3d2a1b', fret: '#a89580', nut: '#f3e6d0', wound: '#e0c28e', plain: '#efe6da', label: '#f3e9dc', sub: '#b8a48f', neutral: '#efe6da', muted: '#ff6b6b' },
    chart: { grid: 'rgba(255,240,220,0.07)', axis: '#8c7a66', line: '#f2c078', fill: ['rgba(255,107,74,0.9)', 'rgba(242,192,120,0.7)', 'rgba(242,192,120,0.05)'], beat: '217,130,43', mark: 'rgba(155,227,122,0.9)', playhead: '#fff4e6' },
    bg3d: ['#d9822b', '#f2c078', '#ff6b4a'],
  },
  {
    id: 'oceano',
    name: 'Oceano',
    hint: 'azul profundo e verde-água',
    light: false,
    ui: { ink: '#03101a', panel: '#0a1b28', line: '#16324a', accent: '#2f80ed', accent2: '#2de2c4', text: '#e3f1fb' },
    degrees: {
      root: d('#ff7a8a'), third: d('#ffd84d'), fifth: d('#4fc3ff'), seventh: d('#b69cff'),
      ninth: d('#7ee081'), fourth: d('#ff9ed8'), sixth: d('#ffae57'),
    },
    board: { wood: '#0d2536', inlay: '#17374d', fret: '#7f9fb8', nut: '#e8f1f7', wound: '#cdb98f', plain: '#e3f1fb', label: '#e3f1fb', sub: '#8fb0c8', neutral: '#e3f1fb', muted: '#ff6b6b' },
    chart: { grid: 'rgba(227,241,251,0.07)', axis: '#6d8ea6', line: '#2de2c4', fill: ['rgba(255,122,138,0.9)', 'rgba(45,226,196,0.7)', 'rgba(45,226,196,0.05)'], beat: '47,128,237', mark: 'rgba(255,216,77,0.9)', playhead: '#ffffff' },
    bg3d: ['#2f80ed', '#2de2c4', '#ff7a8a'],
  },
  {
    id: 'daltonico',
    name: 'Daltônico-seguro',
    hint: 'cores Okabe-Ito, distinguíveis com daltonismo',
    light: false,
    ui: { ink: '#07080c', panel: '#11131a', line: '#262a36', accent: '#0072b2', accent2: '#56b4e9', text: '#eceef3' },
    degrees: {
      root: d('#d55e00'), third: d('#f0e442'), fifth: d('#56b4e9'), seventh: d('#cc79a7'),
      ninth: d('#009e73'), fourth: d('#e69f00'), sixth: d('#3d8fd6', '#ffffff'),
    },
    board: { wood: '#171a23', inlay: '#2a2f3d', fret: '#8a93a8', nut: '#f3efe6', wound: '#d8c29a', plain: '#e3e8f0', label: '#eceef3', sub: '#9aa3b2', neutral: '#eceef3', muted: '#ff6b6b' },
    chart: { grid: 'rgba(255,255,255,0.06)', axis: '#6b7280', line: '#56b4e9', fill: ['rgba(213,94,0,0.9)', 'rgba(86,180,233,0.7)', 'rgba(86,180,233,0.05)'], beat: '204,121,167', mark: 'rgba(240,228,66,0.9)', playhead: '#ffffff' },
    bg3d: ['#0072b2', '#56b4e9', '#e69f00'],
  },
  {
    id: 'claro',
    name: 'Claro',
    hint: 'fundo claro, bom no sol',
    light: true,
    ui: { ink: '#f6f4ef', panel: '#ffffff', line: '#e2ded3', accent: '#5b3fe0', accent2: '#0e8fa6', text: '#1b1f2a' },
    degrees: {
      root: d('#d7263d', '#ffffff'), third: d('#e0a100'), fifth: d('#1e88e5', '#ffffff'), seventh: d('#7e57c2', '#ffffff'),
      ninth: d('#2e9d5b', '#ffffff'), fourth: d('#c2185b', '#ffffff'), sixth: d('#e65100', '#ffffff'),
    },
    board: { wood: '#ece6da', inlay: '#d6ccb8', fret: '#8a8170', nut: '#5a5040', wound: '#9a7b4a', plain: '#6b7280', label: '#1b1f2a', sub: '#5b6474', neutral: '#374151', muted: '#d7263d' },
    chart: { grid: 'rgba(27,31,42,0.08)', axis: '#6b7280', line: '#0e8fa6', fill: ['rgba(215,38,61,0.85)', 'rgba(14,143,166,0.6)', 'rgba(14,143,166,0.05)'], beat: '91,63,224', mark: 'rgba(224,161,0,0.95)', playhead: '#1b1f2a' },
    bg3d: ['#5b3fe0', '#0e8fa6', '#d7263d'],
  },
]

export const DEFAULT_THEME: ThemeId = 'neon'

// No tema claro invertemos os cinzas e o branco/preto do Tailwind: assim
// "text-white" vira texto escuro, "text-slate-400" um cinza médio legível etc.
const LIGHT_OVERRIDES: Record<string, string> = {
  '--color-white': '#1b1f2a',
  '--color-black': '#ffffff',
  '--color-slate-100': '#1e293b',
  '--color-slate-200': '#273244',
  '--color-slate-300': '#3b4658',
  '--color-slate-400': '#566172',
  '--color-slate-500': '#6b7483',
  '--color-slate-600': '#a3abb8',
  '--color-amber-200': '#9a6a00',
  '--color-amber-300': '#b07800',
  '--color-emerald-300': '#15803d',
  '--color-emerald-400': '#16a34a',
  '--color-rose-200': '#9f1239',
  '--color-rose-300': '#be123c',
}

let current: Theme = THEMES.find((t) => t.id === readStored<ThemeId>('tema', DEFAULT_THEME)) ?? THEMES[0]
const listeners = new Set<() => void>()

/** Aplica o tema na página (variáveis CSS e cor da barra do navegador). */
export function applyTheme(theme: Theme = current) {
  const root = document.documentElement
  root.dataset.theme = theme.id
  root.style.colorScheme = theme.light ? 'light' : 'dark'
  const vars: Record<string, string> = {
    '--color-ink': theme.ui.ink,
    '--color-panel': theme.ui.panel,
    '--color-line': theme.ui.line,
    '--color-accent': theme.ui.accent,
    '--color-accent-2': theme.ui.accent2,
    '--app-text': theme.ui.text,
  }
  for (const k of Object.keys(LIGHT_OVERRIDES)) root.style.removeProperty(k)
  if (theme.light) Object.assign(vars, LIGHT_OVERRIDES)
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.ui.ink)
}

export function setTheme(id: ThemeId) {
  current = THEMES.find((t) => t.id === id) ?? THEMES[0]
  writeStored('tema', current.id)
  applyTheme(current)
  listeners.forEach((l) => l())
}

/** Tema atual; o componente redesenha quando o tema muda. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
