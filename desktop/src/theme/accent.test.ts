import { describe, expect, it } from 'vitest'
import {
  ACCENT_PRESETS,
  ACCENT_STORAGE_KEY,
  ACCENT_VARIABLES,
  MONO_ACCENT,
  accentPalette,
  applyAccent,
  contrastRatio,
  normalizeAccent,
  persistAccent,
  readStoredAccent,
} from './accent'

const COLORED = ACCENT_PRESETS.filter(preset => preset.value !== MONO_ACCENT).map(preset => preset.value)
// Extremes a custom pick can hit: near-black, near-white, pure yellow.
const CUSTOM = ['#101010', '#F4F4F4', '#FFFF00', '#0000FF']

describe('theme color', () => {
  it('is black and white unless a color was picked', () => {
    expect(ACCENT_PRESETS[0]!.value).toBe(MONO_ACCENT)
    expect(normalizeAccent(undefined)).toBe(MONO_ACCENT)
    expect(normalizeAccent('red')).toBe(MONO_ACCENT)
    expect(normalizeAccent('#d07b52')).toBe('#D07B52')
    expect(accentPalette(MONO_ACCENT, true)).toBeNull()
    expect(accentPalette(MONO_ACCENT, false)).toBeNull()
  })

  for (const dark of [true, false]) {
    const ground = dark ? '#121212' : '#FFFFFF'
    for (const accent of [...COLORED, ...CUSTOM]) {
      it(`keeps ${accent} readable on the ${dark ? 'dark' : 'light'} ground`, () => {
        const palette = accentPalette(accent, dark)!
        expect(contrastRatio(palette['--cc-on-ac'], palette['--cc-ac'])).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(palette['--cc-on-ac'], palette['--cc-ac2'])).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(palette['--cc-ac-ink'], palette['--cc-ac-soft'])).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(palette['--cc-ac'], ground)).toBeGreaterThanOrEqual(3)
        expect(palette['--cc-ac-rgb']).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/)
      })
    }
  }

  it('paints the picked color on <html> and clears it again for black and white', () => {
    const root = document.createElement('div')
    applyAccent(root, '#4F8CF7', 'dark')
    for (const variable of ACCENT_VARIABLES) expect(root.style.getPropertyValue(variable)).not.toBe('')
    expect(root.style.getPropertyValue('--cc-ac')).toBe('#4F8CF7')

    applyAccent(root, '#4F8CF7', 'white')
    // Same pick, re-derived for paper: deepened until white text reads on it.
    expect(contrastRatio(root.style.getPropertyValue('--cc-ac'), '#FFFFFF')).toBeGreaterThanOrEqual(4.5)

    applyAccent(root, MONO_ACCENT, 'white')
    for (const variable of ACCENT_VARIABLES) expect(root.style.getPropertyValue(variable)).toBe('')
  })

  it('stores the pick normalized', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    expect(readStoredAccent(storage)).toBe(MONO_ACCENT)
    persistAccent('#2fb380', storage)
    expect(values.get(ACCENT_STORAGE_KEY)).toBe('#2FB380')
    expect(readStoredAccent(storage)).toBe('#2FB380')
    persistAccent('not a color', storage)
    expect(readStoredAccent(storage)).toBe(MONO_ACCENT)
  })
})
