/**
 * The product name from the STAR console (`branding.appName` of the public
 * `GET /api/desktop/config?platform=windows`), cached in
 * `<config>/cc-haha/star/brand.json` `{ "name", "updatedAt" }` for the desktop
 * shell, the Electron host (tray, window title, notifications) and the agent.
 *
 * Asked again at most every 30 minutes (a failed request too); a failure keeps
 * the cached name, and without any cache the name is STAR. Normalization rules:
 * utils/starBrand.ts.
 */

import * as path from 'node:path'
import {
  normalizeStarBrandName,
  readStarBrandRecord,
  STAR_BRAND_DEFAULT,
} from '../../../utils/starBrand.js'
import { starRequest } from './starClient.js'
import { loadStarSettings, starConfigDir, writePrivateJson } from './starConfig.js'

export const STAR_BRAND_FILE = 'brand.json'
export const STAR_BRAND_REFRESH_MS = 30 * 60_000

export function starBrandPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(starConfigDir(env), STAR_BRAND_FILE)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** The normalized `branding.appName` of a desktop config answer. */
export function brandNameFromDesktopConfig(payload: unknown): string {
  return normalizeStarBrandName(record(record(payload)?.branding)?.appName)
}

/** The cached name, STAR before the first successful fetch. */
export function readStarBrandName(): string {
  return readStarBrandRecord(starBrandPath())?.name ?? STAR_BRAND_DEFAULT
}

let lastAttempt: { at: number; key: string } | null = null
let inflight: Promise<string> | null = null

/**
 * Fetch the name when it is due: the cache is missing or older than 30
 * minutes and this process did not ask within the last 30 minutes, or the
 * service address changed. Resolves to the name to show either way.
 */
export async function refreshStarBrand(options: { force?: boolean } = {}): Promise<string> {
  const settings = loadStarSettings()
  const file = starBrandPath()
  const cached = readStarBrandRecord(file)
  const fallback = cached?.name ?? STAR_BRAND_DEFAULT
  if (!settings.configured) return fallback
  if (inflight) return inflight

  const now = Date.now()
  const key = `${settings.baseUrl}|${file}`
  const moved = lastAttempt !== null && lastAttempt.key !== key
  const askedRecently = lastAttempt !== null && now - lastAttempt.at < STAR_BRAND_REFRESH_MS
  const stale = !cached || now - cached.updatedAt >= STAR_BRAND_REFRESH_MS
  if (!options.force && !moved && (askedRecently || !stale)) return fallback

  lastAttempt = { at: now, key }
  inflight = (async () => {
    try {
      const payload = await starRequest('GET', '/desktop/config?platform=windows', { settings, timeoutMs: 15_000 })
      // A non-JSON answer (a proxy's page) says nothing about the name.
      if (!record(payload)) return fallback
      const name = brandNameFromDesktopConfig(payload)
      writePrivateJson(file, { name, updatedAt: Date.now() })
      return name
    } catch {
      return fallback
    }
  })().finally(() => {
    inflight = null
  })
  return inflight
}

/** Waits for a due refresh at most `waitMs`, so a status answer is never held up long. */
export async function currentStarBrandName(waitMs = 1_500): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), waitMs)
  })
  try {
    return (await Promise.race([refreshStarBrand(), timeout])) ?? readStarBrandName()
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function resetStarBrandRefreshForTests(): void {
  lastAttempt = null
  inflight = null
}
