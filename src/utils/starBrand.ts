/**
 * The product name the STAR console sets: `branding.appName` of the public
 * `GET /api/desktop/config` (the console's 网站名称, per host). The local
 * server caches it in `<config>/cc-haha/star/brand.json` `{ "name", "updatedAt" }`
 * (see server/services/star/starBrand.ts); the agent reads that file to name
 * itself and its permission prompts, the desktop shell to name its UI.
 *
 * Same rules as STAR Code's common/starBrand.ts: control characters and angle
 * brackets become spaces, runs of spaces collapse, at most 24 characters; an
 * empty name or the console's unset default "MaxClaw" is STAR. Product names
 * are "X Agent" / "X Code", without doubling a name that already ends so.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from './envUtils.js'

/** The name when the console sets none, or before it was ever fetched. */
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

/** `{brand}` → X, `{brandAgent}` → X Agent, `{brandCode}` → X Code; other braces stay. */
export function formatStarBrand(text: string, brand: string): string {
  return text
    .replace(/\{brandCode\}/g, starBrandProductName(brand, 'Code'))
    .replace(/\{brandAgent\}/g, starBrandProductName(brand, 'Agent'))
    .replace(/\{brand\}/g, brand.trim() || STAR_BRAND_DEFAULT)
}

export type StarBrandRecord = { name: string; updatedAt: number }

/** `<CLAUDE_CONFIG_DIR or ~/.claude>/cc-haha/star/brand.json`, next to the STAR session. */
export function starBrandFile(configDir: string = getClaudeConfigHomeDir()): string {
  return join(configDir, 'cc-haha', 'star', 'brand.json')
}

/** A brand.json body; anything without a string `name` is no record. */
export function parseStarBrandRecord(raw: unknown): StarBrandRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (typeof record.name !== 'string') return null
  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : 0
  return { name: normalizeStarBrandName(record.name), updatedAt }
}

export function readStarBrandRecord(file: string = starBrandFile()): StarBrandRecord | null {
  try {
    return parseStarBrandRecord(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

/** Permission checks ask often; the file is read again at most this often. */
const READ_TTL_MS = 5_000
let memo: { file: string; at: number; name: string } | null = null

/** The cached console name, STAR until the server fetched one. */
export function getStarBrandName(): string {
  const file = starBrandFile()
  const now = Date.now()
  if (memo && memo.file === file && now - memo.at < READ_TTL_MS) return memo.name
  const name = readStarBrandRecord(file)?.name ?? STAR_BRAND_DEFAULT
  memo = { file, at: now, name }
  return name
}

/** "X Agent", the name the agent introduces itself with. */
export function getStarAgentName(): string {
  return starBrandProductName(getStarBrandName(), 'Agent')
}

export function resetStarBrandNameCacheForTests(): void {
  memo = null
}
