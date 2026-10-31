import { starApi, type StarUpdateInfo } from '../api/star'
import type { TranslationKey } from '../i18n'
import { getDesktopHost } from './desktopHost'

/** First automatic check after start (not competing with startup traffic), then every 6 hours. */
export const STAR_UPDATE_FIRST_CHECK_DELAY_MS = 8000
export const STAR_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * The backend's compareVersions (desktop-extras-logic.ts), as STAR Code ports it
 * too: 1 when a > b, -1 when a < b, 0 when equal. Numeric segments, optional
 * `v` prefix, missing segments count as 0 (1.2 equals 1.2.0), and with equal
 * numbers a pre-release is lower (1.2.0-beta < 1.2.0).
 */
export function compareVersions(a: string, b: string): number {
  const parse = (raw: string) => {
    const [core = '', ...rest] = String(raw ?? '').trim().replace(/^v/i, '').split('-')
    const nums = core.split('.').map(part => {
      const value = Number.parseInt(part, 10)
      return Number.isFinite(value) ? value : 0
    })
    return { nums, pre: rest.join('-') }
  }
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < Math.max(left.nums.length, right.nums.length); index++) {
    const diff = (left.nums[index] ?? 0) - (right.nums[index] ?? 0)
    if (diff) return diff > 0 ? 1 : -1
  }
  if (left.pre === right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  return left.pre > right.pre ? 1 : -1
}

export type StarUpdateCheck = { current: string; latest: StarUpdateInfo; hasUpdate: boolean }

export const STAR_UPDATE_CURRENT_TEXT = '当前已是最新版本'
/** Shown when the console could not answer: online updates are simply not offered right now. */
export const STAR_UPDATE_UNAVAILABLE_TEXT = '暂未开放在线更新'

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

/**
 * The one-line update status. A failed check reads calm instead of as an error,
 * and never claims the build is current.
 */
export function starUpdateStatusText(check: StarUpdateCheck | null, failed: boolean, t: Translate): string {
  if (failed) return t('update.starUnavailable')
  if (!check) return ''
  if (!check.hasUpdate) return t('update.starUpToDate')
  const version = displayStarVersion(check.latest.version ?? '')
  return t(check.latest.mandatory ? 'update.starFoundMandatory' : 'update.starFound', { version })
}

/** Versions are shown without the `v` prefix. */
export function displayStarVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

const HTML_ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', '#39': '\'' }

/**
 * Release notes as plain text: the console may store rich text, so block tags
 * become line breaks and every other tag is dropped. At most maxChars.
 */
export function starReleaseNotesText(notes: string, maxChars = 3000): string {
  const text = notes
    .replace(/\r\n?/g, '\n')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr|ul|ol|blockquote|pre)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (_, name: string) => HTML_ENTITIES[name] ?? '')
    .split('\n').map(line => line.trimEnd()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text
}

/** localStorage: the version the user put off with 稍后 (or downloaded). */
export const STAR_UPDATE_DISMISS_KEY = 'star.update.dismissed'

/**
 * Whether the startup/periodic notice should show this check. An optional
 * release stays quiet once its version was put off; a mandatory one comes back
 * on every start, once per run.
 */
export function shouldAnnounceStarUpdate(
  check: StarUpdateCheck,
  state: { dismissedVersion: string; handledThisRun: ReadonlySet<string> },
): boolean {
  const version = check.latest.version
  if (!check.hasUpdate || !version || state.handledThisRun.has(version)) return false
  return check.latest.mandatory || state.dismissedVersion !== version
}

/** The release published in the STAR console for this platform (not GitHub). */
export async function checkStarUpdate(): Promise<StarUpdateCheck> {
  const host = getDesktopHost()
  const [current, latest] = await Promise.all([
    host.app.getVersion().catch(() => '0.0.0'),
    starApi.updateInfo(navigator.platform.toLowerCase().includes('mac') ? 'mac' : navigator.platform.toLowerCase().includes('linux') ? 'linux' : 'win'),
  ])
  // Without a web download page there is nowhere to send the user.
  const downloadable = /^https?:\/\//i.test(latest.downloadUrl ?? '')
  return { current, latest, hasUpdate: Boolean(latest.version && downloadable && compareVersions(latest.version, current) > 0) }
}
