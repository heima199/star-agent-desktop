/**
 * The product name the STAR console sets (`branding.appName` of the public
 * desktop config; the local server caches it in `<config>/cc-haha/star/brand.json`
 * and reports it as `StarStatus.brandName`). Shared by the renderer (texts with
 * `{brand}`, `{brandAgent}`, `{brandCode}`) and the Electron host (tray, window
 * title, notifications).
 *
 * Same rules as the server's utils/starBrand.ts and STAR Code's starBrand.ts:
 * control characters and angle brackets become spaces, runs of spaces
 * collapse, at most 24 characters; empty or the console's unset default
 * "MaxClaw" is STAR. "X Agent" / "X Code" never double the last word.
 * Packaging names (exe, installer, Start menu, CLI) do not follow it.
 */

/** The name when the console sets none, or before the first answer. */
export const STAR_BRAND_DEFAULT = 'STAR'
/** Characters kept (a CJK character counts as one). */
export const STAR_BRAND_MAX_LENGTH = 24

/** What the console answers when its 网站名称 was never filled in. */
const PLACEHOLDER_NAMES: readonly string[] = ['maxclaw']

export function normalizeStarBrandName(raw: unknown): string {
  if (typeof raw !== 'string') return STAR_BRAND_DEFAULT
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f-\u009f<>]/g, ' ').replace(/\s+/g, ' ').trim()
  const clipped = [...cleaned].slice(0, STAR_BRAND_MAX_LENGTH).join('').trim()
  if (!clipped || PLACEHOLDER_NAMES.includes(clipped.toLowerCase())) return STAR_BRAND_DEFAULT
  return clipped
}

export type StarBrandProduct = 'Agent' | 'Code'

/** "X Agent" / "X Code"; a name that already ends with the word stays as it is. */
export function starBrandProductName(brand: string, product: StarBrandProduct): string {
  const name = brand.trim() || STAR_BRAND_DEFAULT
  return new RegExp(`(^|\\s)${product}$`, 'i').test(name) ? name : `${name} ${product}`
}

/** The values of the three placeholders for one name. */
export function starBrandParams(brand: string): { brand: string; brandAgent: string; brandCode: string } {
  return {
    brand: brand.trim() || STAR_BRAND_DEFAULT,
    brandAgent: starBrandProductName(brand, 'Agent'),
    brandCode: starBrandProductName(brand, 'Code'),
  }
}

/** `{brand}` → X, `{brandAgent}` → X Agent, `{brandCode}` → X Code; other braces stay. */
export function formatStarBrand(text: string, brand: string): string {
  const params = starBrandParams(brand)
  return text
    .replace(/\{brandCode\}/g, params.brandCode)
    .replace(/\{brandAgent\}/g, params.brandAgent)
    .replace(/\{brand\}/g, params.brand)
}
