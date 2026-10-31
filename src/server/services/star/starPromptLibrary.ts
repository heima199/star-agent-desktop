/**
 * 站点提示词 for the Code and Design home pages: a read-only proxy of the STAR
 * service's public prompt catalog (`/api/plaza-sitelib`, maintained in the STAR
 * admin under 全局广场 → 站点提示词). Public data, so no sign-in is needed.
 *
 * The proxy makes cover URLs absolute, trims fields, fetches the full text of
 * very long prompts (stored as .txt under /uploads) and keeps short caches:
 * strip and facets 10 minutes, list pages 60 seconds, details 10 minutes.
 */

import { loadStarSettings } from './starConfig.js'

export type StarPromptGroup = 'image' | 'video' | 'motion' | 'design' | 'frontend'

/**
 * Template prompts are shown as STAR's own: the catalog's source fields
 * (`siteName`, `homepage`, `authorName`) are dropped here and never reach the
 * desktop, so there is no 查看来源 link and no origin to read off a card.
 */
export type StarPromptCard = {
  id: string
  title: string
  summary: string
  coverUrl: string
  group: StarPromptGroup | ''
  subcategory: string
  tags: string[]
  promptChars: number
  excerpt: string
  /** Where the prompt is meant to run: chat, image or video generation. */
  invokePath: '/chat' | '/image' | '/video'
}

export type StarPromptDetail = StarPromptCard & {
  prompt: string
  /** The full text could not be fetched; `prompt` holds only its beginning. */
  promptTruncated: boolean
  meta: Record<string, string>
}

export type StarPromptFacets = {
  total: number
  groups: { id: StarPromptGroup; name: string; count: number; subs: { id: string; name: string; count: number }[] }[]
}

export type StarPromptPage = { items: StarPromptCard[]; total: number; page: number; pageSize: number; hasMore: boolean }

const GROUPS = new Set<StarPromptGroup>(['image', 'video', 'motion', 'design', 'frontend'])
/** Home-page modes: code-driven pieces for Code, generated media for Design. */
export const STAR_PROMPT_MODE_GROUPS: Record<'code' | 'design', StarPromptGroup[]> = {
  code: ['design', 'frontend', 'motion'],
  design: ['image', 'video'],
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SUB_RE = /^(img|vid|mo|ds|fe)-[a-z]{2,12}$/
const PROMPT_FILE_RE = /^\/uploads\/plaza-sitelib\/prompts\/[A-Za-z0-9][A-Za-z0-9._/-]{0,200}\.txt$/
const META_KEYS = ['model', 'aspect', 'duration', 'style', 'scene', 'tips', 'cli', 'variant', 'deps']
const MAX_FULL_PROMPT_BYTES = 8 * 1024 * 1024
const STRIP_TTL = 10 * 60_000
const LIST_TTL = 60_000
const ITEM_TTL = 10 * 60_000

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clip(value: unknown, max: number): string {
  const raw = text(value).replace(/\s+/g, ' ')
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw
}

function origin(): string {
  return loadStarSettings().baseUrl.replace(/\/+$/, '')
}

function mediaUrl(raw: unknown): string {
  const value = text(raw)
  if (!value) return ''
  if (/^https:\/\//i.test(value)) return value
  if (value.startsWith('/uploads/')) return `${origin()}${value}`
  return ''
}

export function normalizeStarPromptCard(raw: unknown): StarPromptCard | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = text(String(item.id ?? ''))
  if (!UUID_RE.test(id)) return null
  const group = text(item.group) as StarPromptGroup
  const sub = text(item.subcategory)
  const invoke = text(item.invokePath)
  return {
    id,
    title: clip(item.title, 120) || '未命名提示词',
    summary: clip(item.summary, 300),
    coverUrl: mediaUrl(item.coverUrl),
    group: GROUPS.has(group) ? group : '',
    subcategory: SUB_RE.test(sub) ? sub : '',
    tags: (Array.isArray(item.tags) ? item.tags : [])
      .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0 && tag.trim().length <= 24)
      .map(tag => tag.trim())
      .slice(0, 6),
    promptChars: Math.max(0, Number(item.promptChars) || 0),
    excerpt: clip(item.excerpt, 220),
    invokePath: invoke === '/image' || invoke === '/video' ? invoke : '/chat',
  }
}

type CacheEntry = { at: number; value?: unknown; pending?: Promise<unknown> }

function boundedCache(max: number) {
  const entries = new Map<string, CacheEntry>()
  return async function get<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = entries.get(key)
    if (hit && Date.now() - hit.at < ttl) return (hit.pending ?? hit.value) as T
    const pending = load().then(
      (value) => {
        entries.delete(key)
        entries.set(key, { at: Date.now(), value })
        while (entries.size > max) entries.delete(entries.keys().next().value!)
        return value
      },
      (error) => {
        entries.delete(key)
        throw error
      },
    )
    entries.set(key, { at: Date.now(), pending })
    return pending
  }
}

const shared = boundedCache(8)
const lists = boundedCache(200)
const items = boundedCache(100)

export class StarPromptError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'StarPromptError'
  }
}

async function getJson(apiPath: string): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(`${origin()}${apiPath}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new StarPromptError('提示词库暂时加载不了，请稍后再试', 502)
  }
  if (response.status === 404) throw new StarPromptError('提示词不存在或已下架', 404)
  const body = await response.json().catch(() => null) as unknown
  if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) {
    throw new StarPromptError('提示词库暂时加载不了，请稍后再试', 502)
  }
  return body as Record<string, unknown>
}

/** The rotating strip above the composer, limited to the groups of a home-page mode. */
export async function starPromptStrip(mode: 'code' | 'design' | 'all'): Promise<StarPromptCard[]> {
  const all = await shared('strip', STRIP_TTL, async () => {
    const body = await getJson('/api/plaza-sitelib/strip?limit=60')
    return (Array.isArray(body.items) ? body.items : [])
      .map(normalizeStarPromptCard)
      .filter((item): item is StarPromptCard => !!item?.coverUrl)
  })
  if (mode === 'all') return all
  const groups = STAR_PROMPT_MODE_GROUPS[mode]
  return all.filter(item => item.group && groups.includes(item.group))
}

export async function starPromptFacets(): Promise<StarPromptFacets> {
  return shared('facets', STRIP_TTL, async () => {
    const body = await getJson('/api/plaza-sitelib/facets')
    const groups = (Array.isArray(body.groups) ? body.groups : [])
      .filter((group): group is Record<string, unknown> => !!group && typeof group === 'object' && GROUPS.has(text((group as Record<string, unknown>).id) as StarPromptGroup))
      .map(group => ({
        id: text(group.id) as StarPromptGroup,
        name: clip(group.name, 20),
        count: Number(group.count) || 0,
        subs: (Array.isArray(group.subs) ? group.subs : [])
          .filter((sub): sub is Record<string, unknown> => !!sub && typeof sub === 'object' && SUB_RE.test(text((sub as Record<string, unknown>).id)))
          .map(sub => ({ id: text(sub.id), name: clip(sub.name, 20), count: Number(sub.count) || 0 })),
      }))
    return { total: Number(body.total) || 0, groups }
  })
}

export type StarPromptListQuery = { group?: string; sub?: string; q?: string; page?: number; pageSize?: number }

export async function starPromptList(query: StarPromptListQuery): Promise<StarPromptPage> {
  const group = text(query.group)
  const sub = text(query.sub)
  if (group && !GROUPS.has(group as StarPromptGroup)) throw new StarPromptError('分类不正确', 400)
  if (sub && !SUB_RE.test(sub)) throw new StarPromptError('细分不正确', 400)
  const q = text(query.q).slice(0, 60)
  const page = Math.min(500, Math.max(1, Math.round(query.page ?? 1)))
  const pageSize = Math.min(48, Math.max(6, Math.round(query.pageSize ?? 24)))
  const params = new URLSearchParams()
  if (group) params.set('group', group)
  if (sub) params.set('sub', sub)
  if (q) params.set('q', q)
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  const apiPath = `/api/plaza-sitelib?${params}`
  return lists(apiPath, LIST_TTL, async () => {
    const body = await getJson(apiPath)
    const list = (Array.isArray(body.items) ? body.items : [])
      .map(normalizeStarPromptCard)
      .filter((item): item is StarPromptCard => !!item)
    const total = Number(body.total) || 0
    return { items: list, total, page, pageSize, hasMore: (page - 1) * pageSize + list.length < total }
  })
}

/** Very long prompts live in a .txt under /uploads; anything else falls back to the stored beginning. */
async function loadFullPrompt(raw: Record<string, unknown>): Promise<{ text: string; truncated: boolean }> {
  const head = typeof raw.prompt === 'string' ? raw.prompt : ''
  const promptUrl = text(raw.promptUrl)
  if (!promptUrl) return { text: head, truncated: false }
  if (!PROMPT_FILE_RE.test(promptUrl) || promptUrl.includes('..')) return { text: head, truncated: true }
  try {
    const response = await fetch(`${origin()}${promptUrl}`, { signal: AbortSignal.timeout(20_000) })
    const length = Number(response.headers.get('content-length') || 0)
    if (!response.ok || length > MAX_FULL_PROMPT_BYTES) throw new Error(`prompt file ${response.status}`)
    const body = await response.text()
    if (body.length > MAX_FULL_PROMPT_BYTES) throw new Error('prompt file too large')
    return { text: body, truncated: false }
  } catch {
    return { text: head, truncated: true }
  }
}

export async function starPromptDetail(id: string): Promise<StarPromptDetail> {
  const key = text(id).toLowerCase()
  if (!UUID_RE.test(key)) throw new StarPromptError('提示词不存在', 404)
  return items(key, ITEM_TTL, async () => {
    const raw = await getJson(`/api/plaza-sitelib/item/${key}`)
    const card = normalizeStarPromptCard(raw)
    if (!card) throw new StarPromptError('提示词不存在或已下架', 404)
    const prompt = await loadFullPrompt(raw)
    const metaRaw = raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta) ? raw.meta as Record<string, unknown> : {}
    const meta: Record<string, string> = {}
    for (const metaKey of META_KEYS) {
      const value = metaRaw[metaKey]
      if (typeof value === 'string' && value.trim()) meta[metaKey] = clip(value, 400)
      else if (typeof value === 'number' && Number.isFinite(value)) meta[metaKey] = String(value)
    }
    return {
      ...card,
      prompt: prompt.text,
      promptChars: prompt.text.length || card.promptChars,
      promptTruncated: prompt.truncated,
      meta,
    }
  })
}

/** Count a copy / fill-in. Best effort: failures never reach the user. */
export function markStarPromptUsed(id: string): void {
  const key = text(id).toLowerCase()
  if (!UUID_RE.test(key)) return
  void fetch(`${origin()}/api/plaza-sitelib/item/${key}/use`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
}
