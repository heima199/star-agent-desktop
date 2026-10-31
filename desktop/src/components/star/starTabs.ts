import { getStarBrandName } from '../../stores/starBrandStore'

/** Tab ids of the STAR pages. They are not persisted across restarts. */
export const STAR_STUDIO_TAB_ID = '__star_studio__'

/** The studio tab's title, 「X 创作」 with the console's product name (the tab is memory-only, so nothing stored holds it). */
export function starStudioTabTitle(brand: string = getStarBrandName()): string {
  return `${brand} 创作`
}
export const STAR_LIBRARY_TAB_ID = '__star_library__'
export const STAR_PHONE_TAB_ID = '__star_phone__'

export const STAR_TAB_TYPES = ['star-studio', 'star-library', 'star-phone'] as const
export type StarTabType = (typeof STAR_TAB_TYPES)[number]

export function isStarTabType(type: string | undefined): type is StarTabType {
  return !!type && (STAR_TAB_TYPES as readonly string[]).includes(type)
}

/** Pending studio prefill, set by home-page chips that start a creation. */
export type StarStudioPrefill = {
  kind: 'image' | 'video'
  mode?: string
  prompt?: string
}

let studioPrefill: StarStudioPrefill | null = null

export function setStarStudioPrefill(prefill: StarStudioPrefill | null): void {
  studioPrefill = prefill
  window.dispatchEvent(new CustomEvent('star:studio-prefill'))
}

export function takeStarStudioPrefill(): StarStudioPrefill | null {
  const value = studioPrefill
  studioPrefill = null
  return value
}
