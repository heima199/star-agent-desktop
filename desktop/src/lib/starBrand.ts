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
 * "MaxClaw" is STAR. "X STAR WORK" (the desktop app, "X Agent" before 1.2.0) /
 * "X Code" never repeat words the name already ends with.
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

/**
 * The words after the console's name. The desktop app is "X STAR WORK" since
 * 1.2.0 (it was "X Agent"); the IDE stays "X Code". `{brandAgent}` keeps its
 * placeholder name so existing texts need no change.
 */
const PRODUCT_SUFFIX: { [p in StarBrandProduct]: string } = { Agent: 'STAR WORK', Code: 'Code' }

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * "X STAR WORK" / "X Code". Words the name already ends with are not repeated:
 * "PRIVO STAR WORK" stays as it is, and the default name "STAR" (or "PRIVO STAR")
 * only gets " WORK", never "STAR STAR WORK".
 */
export function starBrandProductName(brand: string, product: StarBrandProduct): string {
  const name = brand.trim() || STAR_BRAND_DEFAULT
  const suffixWords = PRODUCT_SUFFIX[product].split(' ')
  // Longest run of the suffix's leading words that the name already ends with
  for (let take = suffixWords.length; take > 0; take--) {
    const lead = suffixWords.slice(0, take).join(' ')
    if (new RegExp(`(^|\\s)${escapeRegExp(lead)}$`, 'i').test(name)) {
      const rest = suffixWords.slice(take).join(' ')
      return rest ? `${name} ${rest}` : name
    }
  }
  return `${name} ${suffixWords.join(' ')}`
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
