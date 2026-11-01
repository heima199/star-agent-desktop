/**
 * STAR portal data for the desktop pages: the operator's desktop config
 * (branding, 关于, support, legal, 推荐 entries), updates, 灵感社区 (plaza),
 * 分销中心 (invite + agent panel) and API 接入 keys.
 *
 * Everything is a thin proxy of the SaaS; only the desktop config is cached
 * because every window reads it on start.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { StarApiError, starRequest } from './starClient.js'
import { loadStarSettings, starConfigDir, starRelayBaseUrl } from './starConfig.js'
import { readStarSession } from './starSession.js'

type Rec = Record<string, unknown>

export type StarAdIcon = { name: string; url: string; icon: string; desc: string }
export type StarAdSlide = { imageUrl: string; title: string; text: string; linkUrl: string }
export type StarLegalDoc = { id: string; title: string; kind: string; url: string; content: string }

export type StarDesktopConfig = {
  fetchedAt: number
  siteName: string
  branding: { appName: string; logoUrl: string; primaryColor: string; tagline: string }
  about: {
    email: string
    communityUrl: string
    manualUrl: string
    termsUrl: string
    privacyUrl: string
    copyright: string
    wecomQr: string
    description: string
  }
  support: {
    enabled: boolean
    url: string
    qrcodeUrl: string
    email: string
    wechatId: string
    hours: string
    description: string
  }
  feedbackEnabled: boolean
  inviteEnabled: boolean
  legal: StarLegalDoc[]
  ads: { icons: StarAdIcon[]; slides: StarAdSlide[] }
}

export type StarUpdateInfo = {
  version: string | null
  downloadUrl: string | null
  releaseNotes: string
  mandatory: boolean
  publishedAt: number | null
}

const CONFIG_TTL_MS = 5 * 60_000
let configCache: { at: number; value: StarDesktopConfig } | null = null

function rec(value: unknown): Rec {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : {}
}

function text(value: unknown, max = 4000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function list(value: unknown): Rec[] {
  if (Array.isArray(value)) return value.map(rec)
  const record = rec(value)
  for (const key of ['items', 'list', 'data', 'rows', 'records']) {
    if (Array.isArray(record[key])) return (record[key] as unknown[]).map(rec)
  }
  return []
}

function token(): string {
  const session = readStarSession()
  if (!session) throw new StarApiError('请先登录 STAR 账号', 401, 'STAR_SIGNED_OUT')
  return session.token
}

function normalizeConfig(desktop: Rec, site: Rec): StarDesktopConfig {
  const branding = rec(desktop.branding)
  const about = rec(desktop.about)
  const support = rec(desktop.support)
  const ads = rec(desktop.ads)
  const carousel = rec(ads.carousel)
  const slides = (Array.isArray(carousel.items) ? carousel.items as unknown[] : []).map(rec)
  const icons = (Array.isArray(ads.icons) ? ads.icons as unknown[] : []).map(rec)
  const topMenu = (Array.isArray(site.topMenuAds) ? site.topMenuAds as unknown[] : []).map(rec)
  const iconEntries: StarAdIcon[] = [...icons, ...topMenu]
    .map(item => ({
      name: text(item.name ?? item.title, 60),
      url: text(item.url ?? item.linkUrl, 2000),
      icon: text(item.icon, 40),
      desc: text(item.desc ?? item.description ?? item.subtitle, 120),
    }))
    .filter(item => item.name)
  const seen = new Set<string>()
  return {
    fetchedAt: Date.now(),
    siteName: text(site.siteName, 60) || text(branding.appName, 60) || 'STAR',
    branding: {
      appName: text(branding.appName, 60) || 'STAR',
      logoUrl: text(branding.logoUrl, 2000),
      primaryColor: text(branding.primaryColor, 20),
      tagline: text(branding.tagline, 200),
    },
    about: {
      email: text(about.email, 200),
      communityUrl: text(about.communityUrl, 2000),
      manualUrl: text(about.manualUrl, 2000),
      termsUrl: text(about.termsUrl, 2000),
      privacyUrl: text(about.privacyUrl, 2000),
      copyright: text(about.copyright, 200),
      wecomQr: text(about.wecomQr ?? about.wecomQrUrl, 2000),
      description: text(about.description ?? about.intro, 2000),
    },
    support: {
      enabled: support.enabled === true,
      url: text(support.url, 2000),
      qrcodeUrl: text(support.qrcodeUrl, 2000),
      email: text(support.email, 200),
      wechatId: text(support.wechatId, 100),
      hours: text(support.hours, 100),
      description: text(support.description, 1000),
    },
    feedbackEnabled: rec(desktop.feedback).enabled !== false,
    inviteEnabled: site.inviteEnabled !== false,
    legal: (Array.isArray(desktop.legal) ? desktop.legal as unknown[] : []).map(rec).map((doc, index) => ({
      id: text(doc.id ?? doc.key ?? doc.type, 80) || `legal-${index}`,
      title: text(doc.title ?? doc.name, 120) || '协议',
      kind: text(doc.type ?? doc.kind, 40),
      url: text(doc.url ?? doc.link, 2000),
      content: text(doc.content ?? doc.body, 200_000),
    })),
    ads: {
      icons: iconEntries.filter(item => (seen.has(item.name) ? false : (seen.add(item.name), true))).slice(0, 12),
      slides: (slides.length ? slides : (text(carousel.title) ? [carousel] : []))
        .map(item => ({
          imageUrl: text(item.imageUrl, 2000),
          title: text(item.title, 120),
          text: text(item.text, 300),
          linkUrl: text(item.linkUrl, 2000),
        }))
        .filter(item => item.title || item.imageUrl)
        .slice(0, 8),
    },
  }
}

export async function getStarDesktopConfig(options: { force?: boolean } = {}): Promise<StarDesktopConfig> {
  if (!options.force && configCache && Date.now() - configCache.at < CONFIG_TTL_MS) return configCache.value
  const session = readStarSession()
  const optional = (path: string) =>
    starRequest<Rec>('GET', path, { token: session?.token, timeoutMs: 15_000 }).catch(() => null)
  const [desktop, site] = await Promise.all([optional('/desktop/config'), optional('/auth/site-config')])
  if (!desktop && !site) {
    if (configCache) return configCache.value
    throw new StarApiError('暂时无法连接 STAR 服务', 502, 'STAR_CONFIG_UNAVAILABLE')
  }
  const value = normalizeConfig(rec(desktop), rec(site))
  configCache = { at: Date.now(), value }
  return value
}

// ─── 用户协议、隐私政策 (legal documents) ──────────────────────

/** One published document: sanitized markup from the console and its plain-text projection. */
export type StarLegalDocument = { id: string; title: string; bodyHtml: string; body: string; updatedAt: number }

/** Characters kept per document: a whole agreement fits, an oversized paste does not reach the UI. */
const LEGAL_DOC_MAX_CHARS = 200_000

/**
 * The user agreement, privacy policy… published in the STAR console. Public
 * (the login form links them before anyone is signed in), so no token is sent.
 * The desktop config only carries their titles; the bodies come from here.
 * A document without a body is left out, as the service does for drafts.
 */
export async function getStarLegalDocs(): Promise<{ docs: StarLegalDocument[] }> {
  const raw = await starRequest<unknown>('GET', '/desktop/legal', { timeoutMs: 15_000 })
  const rows = Array.isArray(raw) ? raw as unknown[] : Array.isArray(rec(raw).docs) ? rec(raw).docs as unknown[] : []
  const docs: StarLegalDocument[] = []
  for (const row of rows.map(rec)) {
    const bodyHtml = text(row.bodyHtml, LEGAL_DOC_MAX_CHARS)
    const body = text(row.body ?? row.content, LEGAL_DOC_MAX_CHARS)
    if (!bodyHtml && !body) continue
    const id = text(row.id ?? row.key, 80)
    const updatedAt = num(row.updatedAt)
    docs.push({ id, title: text(row.title, 120) || id || '协议', bodyHtml, body, updatedAt: updatedAt && updatedAt > 0 ? updatedAt : 0 })
  }
  return { docs }
}

/**
 * This machine's chip as the console names it: the Electron host sets
 * CC_HAHA_HOST_ARCH (arm64 also for an x64 build translated on an ARM
 * machine); without it, the arch this server was built for.
 */
export function starHostArch(env: NodeJS.ProcessEnv = process.env, arch: string = process.arch): 'x64' | 'arm64' | null {
  const value = (env.CC_HAHA_HOST_ARCH?.trim() || arch).toLowerCase()
  if (value === 'x64' || value === 'x86_64' || value === 'amd64') return 'x64'
  if (value === 'arm64' || value === 'aarch64') return 'arm64'
  return null
}

/**
 * The console's update pointer picks one installer per platform and ignores
 * the chip, so an Intel Mac is offered the Apple-chip dmg, which it cannot
 * run. Every release publishes both macOS builds side by side
 * (STAR-Agent-<version>-mac-x64.dmg next to -mac-arm64.dmg), so that one case
 * is pointed at its sibling. Windows is left alone: the x64 installer also
 * runs on ARM64 Windows.
 */
export function starInstallerForChip(downloadUrl: string, arch: string | null): string {
  if (arch !== 'x64') return downloadUrl
  return downloadUrl.replace(/(\/STAR-Agent-[^/?#]+-mac)-arm64(\.(?:dmg|zip))(?=$|[?#])/i, '$1-x64$2')
}

/**
 * The release published for this platform and chip. The console offers an
 * x64 machine only x64 (or untagged) installers, and an ARM machine the arm64
 * one, or the x64 one when no arm64 build was published.
 */
export async function getStarUpdateInfo(platform: string, arch: string | null = starHostArch()): Promise<StarUpdateInfo> {
  const query = new URLSearchParams({ platform })
  if (arch) query.set('arch', arch)
  const raw = rec(await starRequest('GET', `/desktop/update/latest?${query}`, { timeoutMs: 15_000 }))
  const downloadUrl = text(raw.downloadUrl ?? raw.url, 2000) || null
  const published = raw.publishedAt
  const publishedAt = typeof published === 'number'
    ? (published > 0 ? (published < 1e12 ? published * 1000 : published) : null)
    : (typeof published === 'string' && Number.isFinite(Date.parse(published)) ? Date.parse(published) : null)
  return {
    version: text(raw.version, 40) || null,
    downloadUrl: downloadUrl ? starInstallerForChip(downloadUrl, arch) : null,
    releaseNotes: text(raw.releaseNotes ?? raw.notes ?? raw.content, 20_000),
    mandatory: raw.mandatory === true,
    publishedAt,
  }
}

// ─── 3D Make templates (总后台 3D 模型管理) ─────────────────────

export type Star3dTemplate = { id: string; type: string; category: string; title: string; summary: string; coverUrl: string; modelUrl: string; prompt: string }

/** Templates published in the console; an older backend without the module returns an empty list. */
export async function getStar3dTemplates(type?: string): Promise<{ items: Star3dTemplate[]; source: 'star' | 'none' }> {
  const query = type ? `?type=${encodeURIComponent(type)}` : ''
  const raw = await starRequest<unknown>('GET', `/three-d/templates${query}`, { timeoutMs: 15_000 }).catch(() => null)
  if (!raw) return { items: [], source: 'none' }
  const items = list(raw).map(item => ({
    id: text(item.id, 80),
    type: text(item.type, 20) || 'web',
    category: text(item.category, 40),
    title: text(item.title, 120),
    summary: text(item.summary ?? item.description, 400),
    coverUrl: text(item.coverUrl, 2000),
    modelUrl: text(item.modelUrl, 2000),
    prompt: text(item.prompt, 8000),
  })).filter(item => item.id && item.title)
  return { items, source: 'star' }
}

/** 做同款 counter on a console template; ids are uuids, anything else is ignored. */
export async function recordStar3dTemplateUse(id: string): Promise<{ ok: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false }
  await starRequest('POST', `/three-d/templates/${encodeURIComponent(id)}/use`, { timeoutMs: 10_000 }).catch(() => null)
  return { ok: true }
}

// ─── 灵感社区 (plaza) ──────────────────────────────────────

type PlazaPage = {
  categories: { id: string; name: string; children: { id: string; name: string }[] }[]
  items: { id: string; category: string; subcategory: string; title: string; summary: string; coverUrl: string; prompt: string; invokePath: string }[]
  total: number
}

/**
 * The STAR service answers `/plaza` with a whole list whatever `page` says:
 * 全部 is 3 000+ works with their prompts, about 5 MB, which has taken from
 * 5 s to a minute to arrive. So a list is downloaded once and its pages are cut
 * from it:
 *  - for PLAZA_FRESH_MS a list is served as it is;
 *  - after that it is still served at once while one download in the
 *    background replaces it, so a visit does not wait for STAR again;
 *  - lists are kept on disk as well, so the first visit after a restart is
 *    as quick; a list older than PLAZA_KEEP_MS is downloaded again first, and
 *    only served when that download fails.
 * A category is a list of its own: the service orders some differently from
 * 全部, and pages a few (skill, mcp). An answer that is one page of its list
 * (fewer works than its total) is never kept.
 */
const PLAZA_FRESH_MS = 5 * 60_000
const PLAZA_KEEP_MS = 24 * 60 * 60_000
const PLAZA_TIMEOUT_MS = 90_000
const PLAZA_LISTS_KEPT = 8

type KeptPlazaList = { at: number; list: PlazaPage }
const plazaLists = new Map<string, KeptPlazaList>()
const plazaDownloads = new Map<string, Promise<PlazaPage>>()

/** Forgets the lists held in memory, as a restart does; the ones on disk stay. */
export function forgetPlazaListsInMemory(): void {
  plazaLists.clear()
  plazaDownloads.clear()
}

/**
 * One page of a plaza list. A list longer than one page is cut here; a service
 * that does page keeps its own page and total.
 */
export function pagePlazaList(full: PlazaPage, page: number, pageSize: number): PlazaPage {
  if (full.items.length <= pageSize) return full
  const start = (page - 1) * pageSize
  return { ...full, items: full.items.slice(start, start + pageSize), total: Math.max(full.total, full.items.length) }
}

/** The answer holds its whole list, not one page of it. */
function holdsWholeList(answer: PlazaPage): boolean {
  return answer.items.length >= answer.total
}

function plazaListFile(key: string): string {
  return path.join(starConfigDir(), 'plaza', `${createHash('sha1').update(key).digest('hex').slice(0, 16)}.json`)
}

function rememberPlazaList(key: string, kept: KeptPlazaList): void {
  plazaLists.delete(key)
  plazaLists.set(key, kept)
  while (plazaLists.size > PLAZA_LISTS_KEPT) plazaLists.delete(plazaLists.keys().next().value!)
}

function keptPlazaList(key: string): KeptPlazaList | null {
  const inMemory = plazaLists.get(key)
  if (inMemory) return inMemory
  try {
    const stored = JSON.parse(fs.readFileSync(plazaListFile(key), 'utf-8')) as { key?: unknown; at?: unknown; list?: PlazaPage }
    if (stored.key !== key || typeof stored.at !== 'number' || !Array.isArray(stored.list?.items) || !Array.isArray(stored.list?.categories)) return null
    const kept = { at: stored.at, list: stored.list }
    rememberPlazaList(key, kept)
    return kept
  } catch {
    return null
  }
}

/** Keeps a list in memory and on disk, the PLAZA_LISTS_KEPT newest files only. */
async function keepPlazaList(key: string, kept: KeptPlazaList): Promise<void> {
  rememberPlazaList(key, kept)
  const file = plazaListFile(key)
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`
    await fs.promises.writeFile(tmp, JSON.stringify({ key, at: kept.at, list: kept.list }), { encoding: 'utf-8', mode: 0o600 })
    await fs.promises.rename(tmp, file)
    const dir = path.dirname(file)
    const files = await Promise.all((await fs.promises.readdir(dir)).filter(name => name.endsWith('.json')).map(async name => ({ name, at: (await fs.promises.stat(path.join(dir, name))).mtimeMs })))
    for (const old of files.sort((a, b) => b.at - a.at).slice(PLAZA_LISTS_KEPT)) await fs.promises.rm(path.join(dir, old.name), { force: true })
  } catch {
    // A list that cannot be written is still served from memory.
  }
}

/** One download per list and page at a time; a whole list it brings is kept. */
function downloadPlaza(key: string, query: { category?: string; subcategory?: string }, page: number, pageSize: number): Promise<PlazaPage> {
  const id = `${key}#${page}#${pageSize}`
  const running = plazaDownloads.get(id)
  if (running) return running
  const params = new URLSearchParams()
  if (query.category) params.set('category', query.category)
  if (query.subcategory) params.set('subcategory', query.subcategory)
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  const download = fetchPlaza(params)
    .then(async answer => {
      if (holdsWholeList(answer)) await keepPlazaList(key, { at: Date.now(), list: answer })
      return answer
    })
    .finally(() => plazaDownloads.delete(id))
  plazaDownloads.set(id, download)
  return download
}

export async function getStarPlaza(query: { category?: string; subcategory?: string; page?: number; pageSize?: number }): Promise<PlazaPage> {
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(60, Math.max(1, query.pageSize ?? 24))
  const key = `${query.category ?? ''}|${query.subcategory ?? ''}`
  const kept = keptPlazaList(key)
  const age = kept ? Date.now() - kept.at : Number.POSITIVE_INFINITY
  if (kept && age < PLAZA_KEEP_MS) {
    if (age >= PLAZA_FRESH_MS) void downloadPlaza(key, query, 1, pageSize).catch(() => undefined)
    return pagePlazaList(kept.list, page, pageSize)
  }
  try {
    return pagePlazaList(await downloadPlaza(key, query, page, pageSize), page, pageSize)
  } catch (error) {
    // An old list beats an error page while the service cannot answer.
    if (kept) return pagePlazaList(kept.list, page, pageSize)
    throw error
  }
}

async function fetchPlaza(params: URLSearchParams): Promise<PlazaPage> {
  const raw = rec(await starRequest('GET', `/plaza?${params}`, { timeoutMs: PLAZA_TIMEOUT_MS }))
  const categories = (Array.isArray(raw.categories) ? raw.categories as unknown[] : []).map(rec).map(cat => ({
    id: text(cat.id, 80),
    name: text(cat.name, 60),
    children: (Array.isArray(cat.children) ? cat.children as unknown[] : []).map(rec).map(child => ({
      id: text(child.id, 80),
      name: text(child.name, 60),
    })).filter(child => child.id),
  })).filter(cat => cat.id)
  const items = list(raw.items).map(item => ({
    id: text(item.id, 80),
    category: text(item.category, 60),
    subcategory: text(item.subcategory, 60),
    title: text(item.title, 200),
    summary: text(item.summary, 600),
    coverUrl: text(item.coverUrl, 2000),
    prompt: text(item.prompt, 20_000),
    invokePath: text(item.invokePath, 200),
  })).filter(item => item.id)
  return { categories, items, total: num(raw.total) ?? items.length }
}

// ─── 分销中心 ──────────────────────────────────────────────

export async function getStarDistribution(): Promise<{
  invite: Rec | null
  agent: Rec | null
  dashboard: Rec | null
  commissions: Rec[]
  invitedUsers: Rec[]
  withdrawals: Rec[]
}> {
  const bearer = token()
  const optional = (path: string) => starRequest<unknown>('GET', path, { token: bearer, timeoutMs: 15_000 }).catch(() => null)
  const [invite, agent] = await Promise.all([optional('/growth/invite'), optional('/agent-panel/me')])
  const agentRecord = agent && typeof agent === 'object' ? rec(agent) : null
  const approved = Boolean(agentRecord && agentRecord.enabled !== false && (!agentRecord.status || agentRecord.status === 'approved'))
  const [dashboard, commissions, invitedUsers, withdrawals] = approved
    ? await Promise.all([
        optional('/agent-panel/dashboard'),
        optional('/agent-panel/commissions?page=1&limit=20'),
        optional('/agent-panel/invited-users?page=1&limit=20'),
        optional('/agent-panel/withdrawals?page=1&limit=20'),
      ])
    : [null, null, null, null]
  return {
    invite: invite ? rec(invite) : null,
    agent: agentRecord,
    dashboard: dashboard ? rec(dashboard) : null,
    commissions: list(commissions),
    invitedUsers: list(invitedUsers),
    withdrawals: list(withdrawals),
  }
}

export async function starApplyAgent(): Promise<unknown> {
  return starRequest('POST', '/agent-panel/apply', { token: token(), body: {} })
}

export async function starRequestWithdrawal(input: { amount: number; accountType: string; accountInfo: string }): Promise<unknown> {
  if (!(input.amount > 0)) throw new StarApiError('请输入提现金额', 400, 'STAR_BAD_AMOUNT')
  if (!input.accountInfo.trim()) throw new StarApiError('请填写收款账号', 400, 'STAR_BAD_ACCOUNT')
  return starRequest('POST', '/agent-panel/withdraw', {
    token: token(),
    body: { amount: input.amount, accountType: input.accountType || 'alipay', accountInfo: input.accountInfo.trim() },
  })
}

// ─── API 接入 ──────────────────────────────────────────────

export type StarApiKey = { id: string; name: string; tokenMask: string; enabled: boolean; createdAt: string; lastUsedAt: string; remark: string }

function normalizeKey(item: Rec): StarApiKey {
  return {
    id: text(item.id, 80),
    name: text(item.name, 120),
    tokenMask: text(item.tokenMask ?? item.maskedToken ?? item.keyMask, 200),
    enabled: item.enabled !== false && item.status !== 'disabled',
    createdAt: text(item.createdAt, 40),
    lastUsedAt: text(item.lastUsedAt, 40),
    remark: text(item.remark, 300),
  }
}

export async function listStarApiKeys(): Promise<{ keys: StarApiKey[]; baseUrl: string }> {
  const raw = await starRequest<unknown>('GET', '/user-api-keys', { token: token(), timeoutMs: 15_000 })
  return { keys: list(raw).map(normalizeKey).filter(key => key.id), baseUrl: starRelayBaseUrl(loadStarSettings()) }
}

/** Creates a key; the full secret is returned once, never stored here. */
export async function createStarApiKey(name: string): Promise<{ key: StarApiKey; secret: string }> {
  const label = name.trim().slice(0, 60)
  if (!label) throw new StarApiError('请填写密钥名称', 400, 'STAR_BAD_KEY_NAME')
  const raw = rec(await starRequest('POST', '/user-api-keys', { token: token(), body: { name: label }, timeoutMs: 20_000 }))
  const secret = text(raw.token ?? raw.key ?? raw.secret, 400)
  return { key: normalizeKey(raw), secret }
}

export async function deleteStarApiKey(id: string): Promise<void> {
  await starRequest('DELETE', `/user-api-keys/${encodeURIComponent(id)}`, { token: token(), timeoutMs: 15_000 })
}

export async function toggleStarApiKey(id: string): Promise<void> {
  await starRequest('PATCH', `/user-api-keys/${encodeURIComponent(id)}/toggle`, { token: token(), body: {}, timeoutMs: 15_000 })
}
