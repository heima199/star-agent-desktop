/**
 * STAR model catalog: chat models from `/chat/models` (brands → sub models)
 * plus image / video models from `/desktop/config`. Cached on disk so the
 * session model list and the MCP tools can read it without a network call.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { starRequest } from './starClient.js'
import { absoluteStarUrl, loadStarSettings, starConfigDir, writePrivateJson } from './starConfig.js'

export type StarBrand = {
  id: string
  name: string
  logo?: string
  color?: string
}

export type StarChatModel = {
  id: string
  name: string
  brandId: string
  brandName: string
  tier?: string
  credits?: number
  contextWindow?: number
  health?: string
  /** Comma list from the service when it says more than plain chat, e.g. `chat,vision`. */
  capability?: string
}

export type StarImageModel = {
  id: string
  label: string
  badge?: string
  sizes?: string[]
  supportsEdit?: boolean
  pricePerImage?: number
}

export type StarVideoModel = {
  id: string
  label: string
  modes?: string[]
  resolutions?: string[]
  durations?: number[]
  ratios?: string[]
  pricePerSecond?: number
  pricePerGeneration?: number
}

export type StarCatalog = {
  /** Cache shape; an older file is served once and refreshed in the background. */
  version?: number
  fetchedAt: number
  brands: StarBrand[]
  chat: StarChatModel[]
  image: StarImageModel[]
  video: StarVideoModel[]
  videoLimits: {
    maxReferenceImages: number
    maxReferenceVideos: number
    mediaTypes: string[]
  }
  branding?: { appName?: string; logoUrl?: string }
}

/** Default chat model for a fresh sign-in: strong tool use first, then cost. */
export const STAR_PREFERRED_CHAT_MODELS = [
  'claude-sonnet-5.5',
  'claude-sonnet-5',
  'deepseek-v4',
  'gpt-5.5',
  'kimi-k2.6',
  'glm-5.2',
  'qwen3.6-plus',
]

/** Small/fast model for titles and background calls; free ones first. */
export const STAR_PREFERRED_FAST_MODELS = [
  'gemini-2.5-flash',
  'gemini-3-flash',
  'gpt-4.1-mini',
  'gpt-5-mini',
  'deepseek-v4',
]

const CATALOG_FILE = 'catalog.json'
const MIN_REFRESH_MS = 60_000
/** 2: chat models whose capability lists more than `chat` (`chat,vision`) are kept, with `capability`. */
export const STAR_CATALOG_VERSION = 2
const STALE_REFRESH_RETRY_MS = 5 * 60_000
let staleRefreshAt = 0

function catalogPath(): string {
  return path.join(starConfigDir(), CATALOG_FILE)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value.map(str).filter(Boolean)
  return list.length ? list : undefined
}

function numbers(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value.map(num).filter((item): item is number => item !== undefined)
  return list.length ? list : undefined
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Merge `/chat/models` brands with the desktop media lists. */
export function flattenStarCatalog(brandsRaw: unknown, desktopRaw: unknown): StarCatalog {
  const settings = loadStarSettings()
  const brands: StarBrand[] = []
  const chat = new Map<string, StarChatModel>()
  const mediaIds = new Set<string>()

  const desktop = record(desktopRaw)
  const media = record(desktop.media)
  const imageBlock = record(media.image)
  const videoBlock = record(media.video)
  for (const block of [imageBlock, videoBlock]) {
    for (const entry of Array.isArray(block.list) ? block.list : []) {
      const id = str(record(entry).id)
      if (id) mediaIds.add(id)
    }
  }

  for (const rawBrand of Array.isArray(brandsRaw) ? brandsRaw : []) {
    const brand = record(rawBrand)
    const brandId = str(brand.id) || str(brand.name)
    if (!brandId) continue
    const brandName = str(brand.name) || brandId
    let logo = str(brand.icon) || str(brand.brandIcon)
    if (logo && (logo.startsWith('/') || /^https?:/i.test(logo))) logo = absoluteStarUrl(logo, settings)
    const color = str(brand.color) || str(brand.brandColor)
    let hasChat = false
    for (const rawSub of Array.isArray(brand.subModels) ? brand.subModels : []) {
      const sub = record(rawSub)
      const id = str(sub.actualModelId) || str(sub.id)
      // `chat,vision` is still a chat model; only lists without `chat` are media.
      const capabilities = (str(sub.capability) || 'chat').toLowerCase().split(/[\s,]+/).filter(Boolean)
      if (!id || !capabilities.includes('chat') || mediaIds.has(id)) continue
      const health = typeof sub.health === 'string'
        ? sub.health
        : str(record(sub.health).level) || str(record(sub.health).status)
      const contextWindow = num(sub.contextWindow)
      chat.set(id, {
        id,
        name: str(sub.name) || id,
        brandId,
        brandName,
        ...(str(sub.tier) ? { tier: str(sub.tier) } : {}),
        ...(num(sub.creditsPerUse) !== undefined ? { credits: num(sub.creditsPerUse) } : {}),
        ...(contextWindow && contextWindow > 0 ? { contextWindow: Math.round(contextWindow) } : {}),
        ...(health ? { health } : {}),
        ...(capabilities.length > 1 ? { capability: capabilities.join(',') } : {}),
      })
      hasChat = true
    }
    if (hasChat) brands.push({ id: brandId, name: brandName, ...(logo ? { logo } : {}), ...(color ? { color } : {}) })
  }

  const image: StarImageModel[] = []
  for (const rawEntry of Array.isArray(imageBlock.list) ? imageBlock.list : []) {
    const entry = record(rawEntry)
    const id = str(entry.id)
    if (!id) continue
    image.push({
      id,
      label: str(entry.label) || id,
      ...(str(entry.badge) ? { badge: str(entry.badge) } : {}),
      ...(strings(entry.sizes) ? { sizes: strings(entry.sizes) } : {}),
      ...(typeof entry.supportsEdit === 'boolean' ? { supportsEdit: entry.supportsEdit } : {}),
      ...(num(entry.pricePerImage) !== undefined ? { pricePerImage: num(entry.pricePerImage) } : {}),
    })
  }

  const video: StarVideoModel[] = []
  for (const rawEntry of Array.isArray(videoBlock.list) ? videoBlock.list : []) {
    const entry = record(rawEntry)
    const id = str(entry.id)
    if (!id) continue
    video.push({
      id,
      label: str(entry.label) || id,
      ...(strings(entry.modes) ? { modes: strings(entry.modes) } : {}),
      ...(strings(entry.resolutions) ? { resolutions: strings(entry.resolutions) } : {}),
      ...(numbers(entry.durations) ? { durations: numbers(entry.durations) } : {}),
      ...(strings(entry.ratios) ? { ratios: strings(entry.ratios) } : {}),
      ...(num(entry.pricePerSecond) !== undefined ? { pricePerSecond: num(entry.pricePerSecond) } : {}),
      ...(num(entry.pricePerGeneration) !== undefined ? { pricePerGeneration: num(entry.pricePerGeneration) } : {}),
    })
  }

  const branding = record(desktop.branding)
  return {
    version: STAR_CATALOG_VERSION,
    fetchedAt: Date.now(),
    brands,
    chat: [...chat.values()],
    image,
    video,
    videoLimits: {
      maxReferenceImages: num(videoBlock.maxReferenceImages) ?? 3,
      maxReferenceVideos: num(videoBlock.maxReferenceVideos) ?? 0,
      mediaTypes: strings(videoBlock.mediaTypes) ?? [],
    },
    ...(Object.keys(branding).length
      ? { branding: { appName: str(branding.appName) || undefined, logoUrl: str(branding.logoUrl) || undefined } }
      : {}),
  }
}

export function readStarCatalog(): StarCatalog | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath(), 'utf-8')) as StarCatalog
    if (!parsed || !Array.isArray(parsed.chat)) return null
    if (parsed.version !== STAR_CATALOG_VERSION && Date.now() - staleRefreshAt > STALE_REFRESH_RETRY_MS) {
      staleRefreshAt = Date.now()
      void refreshStarCatalog({ force: true }).catch(() => undefined)
    }
    return parsed
  } catch {
    return null
  }
}

let inflight: Promise<StarCatalog> | null = null

/** Re-sync from the service. Calls within a minute reuse the cache unless forced. */
export async function refreshStarCatalog(options: { force?: boolean } = {}): Promise<StarCatalog> {
  const cached = readStarCatalog()
  if (!options.force && cached && Date.now() - cached.fetchedAt < MIN_REFRESH_MS) return cached
  if (inflight) return inflight
  inflight = (async () => {
    const [brands, desktop] = await Promise.all([
      starRequest('GET', '/chat/models', { timeoutMs: 20_000 }),
      starRequest('GET', '/desktop/config', { timeoutMs: 20_000 }),
    ])
    const catalog = flattenStarCatalog(brands, desktop)
    if (catalog.chat.length || catalog.image.length || catalog.video.length) {
      writePrivateJson(catalogPath(), catalog)
    }
    return catalog
  })().finally(() => {
    inflight = null
  })
  return inflight
}

/** First preferred id the catalog offers, else the first chat model. */
export function pickStarModel(catalog: StarCatalog | null, preferred: readonly string[]): string | null {
  const ids = new Set(catalog?.chat.map(model => model.id) ?? [])
  for (const id of preferred) if (ids.has(id)) return id
  return catalog?.chat[0]?.id ?? null
}
