/**
 * The name IM replies give this app: "X Agent", X being the product name the
 * STAR console sets. The local server caches that name in
 * `<CLAUDE_CONFIG_DIR or ~/.claude>/cc-haha/star/brand.json` (`{ "name" }`);
 * the adapters run in their own process and read the same file.
 *
 * Same rules as src/utils/starBrand.ts (which this package does not import):
 * control characters and angle brackets become spaces, spaces collapse, at
 * most 24 characters, and an empty name or the console's unset default
 * "MaxClaw" is STAR. The file is read again at most every few seconds, so a
 * rename in the console reaches the next reply without restarting the adapter.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** The name when the console sets none, or before the server ever fetched one. */
export const IM_BRAND_DEFAULT = 'STAR'
const MAX_LENGTH = 24
const PLACEHOLDER_NAMES: readonly string[] = ['maxclaw']
const READ_TTL_MS = 5_000

export function normalizeImBrandName(raw: unknown): string {
  if (typeof raw !== 'string') return IM_BRAND_DEFAULT
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f-\u009f<>]/g, ' ').replace(/\s+/g, ' ').trim()
  const clipped = [...cleaned].slice(0, MAX_LENGTH).join('').trim()
  if (!clipped || PLACEHOLDER_NAMES.includes(clipped.toLowerCase())) return IM_BRAND_DEFAULT
  return clipped
}

/** "X Agent"; a name that already ends with "Agent" stays as it is. */
export function imAgentNameOf(brand: string): string {
  const name = brand.trim() || IM_BRAND_DEFAULT
  return /(^|\s)Agent$/i.test(name) ? name : `${name} Agent`
}

export function imBrandFile(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
  return path.join(configDir, 'cc-haha', 'star', 'brand.json')
}

function readBrandName(file: string): string {
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    if (!record || typeof record !== 'object' || Array.isArray(record)) return IM_BRAND_DEFAULT
    return normalizeImBrandName((record as Record<string, unknown>).name)
  } catch {
    return IM_BRAND_DEFAULT
  }
}

let memo: { file: string; at: number; name: string } | null = null

/** The console's product name, STAR until the server fetched one. */
export function getImBrandName(): string {
  const file = imBrandFile()
  const now = Date.now()
  if (memo && memo.file === file && now - memo.at < READ_TTL_MS) return memo.name
  const name = readBrandName(file)
  memo = { file, at: now, name }
  return name
}

/** "X Agent", how IM replies name the desktop app and the agent behind the bot. */
export function getImAgentName(): string {
  return imAgentNameOf(getImBrandName())
}

export function resetImBrandCacheForTests(): void {
  memo = null
}
