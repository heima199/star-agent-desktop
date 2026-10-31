/**
 * STAR SaaS bridge settings.
 *
 * The desktop talks to the STAR account service (the same application the STAR
 * Work desktop uses): sign-in, model catalog, relay key, media generation and
 * search. Two values identify the application: the API base URL and the
 * application secret sent as `x-app-secret`. No secret lives in source code;
 * the first source that provides one wins:
 *
 *   1. env `CC_HAHA_STAR_BASE_URL` / `CC_HAHA_STAR_APP_SECRET`
 *   2. `<config>/cc-haha/star/saas.json`  `{ "baseUrl", "appSecret" }`
 *   3. `<app-root>/star-product.json`     `{ "saasBaseUrl", "saasAppSecret" }`
 *      (installed app: `resources/app.asar.unpacked/star-product.json`)
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export const STAR_DEFAULT_BASE_URL = 'https://apisaas.spkx.cn'
/** Provider preset id of the managed STAR account provider. */
export const STAR_PRESET_ID = 'star-saas'
export const STAR_PROVIDER_NAME = 'STAR'
/** Name of the relay key this desktop creates in the user's STAR console. */
export const STAR_RELAY_KEY_NAME = 'STAR cc-haha 桌面端'

export type StarSettingsSource = 'env' | 'user' | 'product' | 'none'

export type StarSettings = {
  baseUrl: string
  appSecret: string
  configured: boolean
  source: StarSettingsSource
}

export function claudeConfigRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

/** `<config>/cc-haha/star` — session, catalog cache, media tasks and outputs. */
export function starConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(claudeConfigRoot(env), 'cc-haha', 'star')
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function trimBase(value: string): string {
  return value.replace(/\/+$/, '')
}

const ASAR_SEGMENT = /\.asar(?=$|[/\\])/

function productFiles(env: NodeJS.ProcessEnv): string[] {
  const files: string[] = []
  const appRoot = env.CLAUDE_APP_ROOT
  if (appRoot) {
    // In an installed app the root is resources/app.asar, which only Electron
    // can read; the package unpacks the file into app.asar.unpacked beside it
    // (desktop/package.json asarUnpack, same mapping as staticH5.ts).
    if (ASAR_SEGMENT.test(appRoot)) files.push(path.join(appRoot.replace(ASAR_SEGMENT, '.asar.unpacked'), 'star-product.json'))
    files.push(path.join(appRoot, 'star-product.json'))
  }
  if (env.CC_HAHA_STAR_PRODUCT_FILE) files.push(env.CC_HAHA_STAR_PRODUCT_FILE)
  return files
}

let cached: { at: number; key: string; value: StarSettings } | null = null

export function loadStarSettings(env: NodeJS.ProcessEnv = process.env): StarSettings {
  const cacheKey = `${env.CLAUDE_CONFIG_DIR ?? ''}|${env.CLAUDE_APP_ROOT ?? ''}|${env.CC_HAHA_STAR_APP_SECRET ? 1 : 0}`
  if (cached && cached.key === cacheKey && Date.now() - cached.at < 5_000) return cached.value

  let baseUrl = trimBase(text(env.CC_HAHA_STAR_BASE_URL))
  let appSecret = text(env.CC_HAHA_STAR_APP_SECRET)
  let source: StarSettingsSource = appSecret ? 'env' : 'none'

  if (!appSecret || !baseUrl) {
    const user = readJsonObject(path.join(starConfigDir(env), 'saas.json'))
    if (user) {
      baseUrl ||= trimBase(text(user.baseUrl))
      if (!appSecret && text(user.appSecret)) {
        appSecret = text(user.appSecret)
        source = 'user'
      }
    }
  }
  if (!appSecret || !baseUrl) {
    for (const file of productFiles(env)) {
      const product = readJsonObject(file)
      if (!product) continue
      baseUrl ||= trimBase(text(product.saasBaseUrl) || text(product.baseUrl))
      if (!appSecret && (text(product.saasAppSecret) || text(product.appSecret))) {
        appSecret = text(product.saasAppSecret) || text(product.appSecret)
        source = 'product'
      }
      if (appSecret && baseUrl) break
    }
  }

  const value: StarSettings = {
    baseUrl: baseUrl || STAR_DEFAULT_BASE_URL,
    appSecret,
    configured: Boolean(appSecret),
    source,
  }
  cached = { at: Date.now(), key: cacheKey, value }
  return value
}

/** Base URL of the relay's OpenAI-compatible API (`/api/v1`). */
export function starRelayBaseUrl(settings: StarSettings = loadStarSettings()): string {
  return `${settings.baseUrl}/api/v1`
}

/** Turn a service-relative path such as `/uploads/x.png` into a public URL. */
export function absoluteStarUrl(raw: string, settings: StarSettings = loadStarSettings()): string {
  const value = raw.trim()
  if (!value) return value
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith('//')) return `https:${value}`
  if (value.startsWith('/')) return `${settings.baseUrl}${value}`
  return value
}

export function writePrivateJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tmp, filePath)
}
