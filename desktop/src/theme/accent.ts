/**
 * The theme color (主题色).
 *
 * STAR is black and white by default: the `--cc-ac*` palette each
 * `[data-theme]` block in globals.css declares is neutral ink on paper and
 * paper on ink. Picking a color in 设置 → 外观 overrides those source
 * variables inline on `<html>`; every semantic token (`--color-brand`, the
 * send key, switches, selection, badges) follows without knowing about it.
 *
 * A color is one hex value. The rest of the accent palette is derived from it
 * per ground, with the same contrast floors the stock palettes are held to in
 * theme/contrast.test.ts: text on the accent and on its soft fill reads at
 * 4.5:1, and the accent itself stands at 3:1 on the page.
 */

import { isDarkTheme, type ThemeMode } from '../types/settings'

export const ACCENT_STORAGE_KEY = 'cc-haha-accent'
/** No hue: the palette globals.css declares. */
export const MONO_ACCENT = 'mono'

export type AccentPreset = { value: string; label: string; swatch: string }

/** One click each in 设置 → 外观. `swatch` is what the dot shows. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { value: MONO_ACCENT, label: '黑白', swatch: '#ECECEA' },
  { value: '#D07B52', label: '赤陶', swatch: '#D07B52' },
  { value: '#4F8CF7', label: '天蓝', swatch: '#4F8CF7' },
  { value: '#8B6CF0', label: '紫罗兰', swatch: '#8B6CF0' },
  { value: '#2FB380', label: '翡翠', swatch: '#2FB380' },
  { value: '#E8689A', label: '玫瑰', swatch: '#E8689A' },
  { value: '#F08A3C', label: '橙光', swatch: '#F08A3C' },
  { value: '#2BB3B1', label: '青碧', swatch: '#2BB3B1' },
]

/** The `--cc-*` source variables the accent owns. */
export const ACCENT_VARIABLES = [
  '--cc-ac',
  '--cc-ac2',
  '--cc-ac-soft',
  '--cc-ac-soft-hover',
  '--cc-ac-border',
  '--cc-ac-ink',
  '--cc-on-ac',
  '--cc-ac-rgb',
] as const

export type AccentVariable = typeof ACCENT_VARIABLES[number]
export type AccentPalette = Record<AccentVariable, string>

type Rgb = [number, number, number]

const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]
/** `--cc-bg` of 深色 and 浅色, the grounds the derived fills sit on. */
const DARK_PAGE: Rgb = [0x12, 0x12, 0x12]
const LIGHT_PAGE: Rgb = WHITE
/** The near-black the dark palette writes on light fills (its `--cc-s0`). */
const DARK_INK: Rgb = [0x18, 0x18, 0x17]

const TEXT_CONTRAST = 4.5
const GRAPHIC_CONTRAST = 3

/** `mono`, or a `#RRGGBB` color in upper case; anything else is `mono`. */
export function normalizeAccent(value: unknown): string {
  if (typeof value !== 'string') return MONO_ACCENT
  const trimmed = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toUpperCase()
  return MONO_ACCENT
}

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/** `from` moved `amount` of the way to `to`. */
function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [0, 1, 2].map(index => from[index]! + (to[index]! - from[index]!) * amount) as Rgb
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(hexToRgb(a))
  const lb = luminance(hexToRgb(b))
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function ratio(a: Rgb, b: Rgb): number {
  return contrastRatio(toHex(a), toHex(b))
}

/** Step `color` toward `target` until it reaches `minimum` against `against`. */
function pushUntil(color: Rgb, target: Rgb, against: Rgb, minimum: number): Rgb {
  let next = color
  for (let step = 0; step < 40 && ratio(next, against) < minimum; step++) next = mix(next, target, 0.06)
  return next
}

/**
 * The accent palette for `accent` on the given ground, or `null` for `mono`
 * (the stylesheet's own palette applies).
 */
export function accentPalette(accent: string, dark: boolean): AccentPalette | null {
  const normalized = normalizeAccent(accent)
  if (normalized === MONO_ACCENT) return null
  const base = hexToRgb(normalized)
  let ac: Rgb
  let ac2: Rgb
  let onAc: Rgb
  let soft: Rgb
  let softHover: Rgb
  let border: Rgb
  if (dark) {
    // Bright accents on ink: lift a dark pick until it stands on the page,
    // then write near-black on it, as the stock terracotta does.
    ac = pushUntil(base, WHITE, DARK_PAGE, GRAPHIC_CONTRAST)
    ac = pushUntil(ac, WHITE, DARK_INK, TEXT_CONTRAST)
    ac2 = mix(ac, WHITE, 0.12)
    onAc = DARK_INK
    soft = mix(DARK_PAGE, ac, 0.18)
    softHover = mix(DARK_PAGE, ac, 0.26)
    border = mix(DARK_PAGE, ac, 0.42)
  } else {
    // Deep accents on paper: darken a light pick until white text reads on it.
    ac = pushUntil(base, BLACK, WHITE, TEXT_CONTRAST)
    ac2 = mix(ac, BLACK, 0.12)
    onAc = WHITE
    soft = mix(LIGHT_PAGE, ac, 0.1)
    softHover = mix(LIGHT_PAGE, ac, 0.16)
    border = mix(LIGHT_PAGE, ac, 0.32)
  }
  const ink = pushUntil(ac, dark ? WHITE : BLACK, soft, TEXT_CONTRAST)
  const rounded = ac.map(Math.round) as Rgb
  return {
    '--cc-ac': toHex(ac),
    '--cc-ac2': toHex(ac2),
    '--cc-ac-soft': toHex(soft),
    '--cc-ac-soft-hover': toHex(softHover),
    '--cc-ac-border': toHex(border),
    '--cc-ac-ink': toHex(ink),
    '--cc-on-ac': toHex(onAc),
    '--cc-ac-rgb': rounded.join(', '),
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function getStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function readStoredAccent(storage: StorageLike | null = getStorage()): string {
  try {
    return normalizeAccent(storage?.getItem(ACCENT_STORAGE_KEY))
  } catch {
    return MONO_ACCENT
  }
}

export function persistAccent(accent: string, storage: StorageLike | null = getStorage()): void {
  try {
    storage?.setItem(ACCENT_STORAGE_KEY, normalizeAccent(accent))
  } catch { /* localStorage unavailable */ }
}

/** Paints `accent` for `theme` on `root` (normally `<html>`). */
export function applyAccent(root: HTMLElement, accent: string, theme: ThemeMode): void {
  const palette = accentPalette(accent, isDarkTheme(theme))
  for (const variable of ACCENT_VARIABLES) {
    if (palette) root.style.setProperty(variable, palette[variable])
    else root.style.removeProperty(variable)
  }
}
