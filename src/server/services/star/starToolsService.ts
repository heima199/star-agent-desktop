/**
 * STAR research and understanding tools: web search, academic paper search,
 * reading a web page, image understanding and document recognition.
 *
 * Service routes used (all with the signed-in user's token):
 *   POST /skills/web-search/execute   free web search (SearXNG → Bing)
 *   POST /skills/web-read/execute     fetch a page, answer with a chat model
 *   POST /search/academic             paper list (OpenAlex / arXiv / …)
 *   POST /upload/extract              document → text (STAR members)
 *   POST /api/v1/chat/completions     relay chat with image parts (vision)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { deflateSync } from 'node:zlib'

import { ensureStarRelayKey } from './starAccountService.js'
import { readStarCatalog } from './starCatalog.js'
import { StarApiError, starRequest, starUpload } from './starClient.js'
import { loadStarSettings, starRelayBaseUrl } from './starConfig.js'
import { publishStarReferences } from './starMediaRefs.js'
import { readStarSession } from './starSession.js'

export type StarSearchHit = { title: string; url: string; snippet: string }

export type StarWebSearchResult = { query: string; results: StarSearchHit[]; latencyMs: number }

export type StarPaper = {
  title: string
  url: string
  summary: string
  source: string
  year: string
}

export type StarAcademicResult = { query: string; total: number; papers: StarPaper[]; latencyMs: number }

export type StarExtractResult = {
  text: string
  type: string
  filename: string
  truncated: boolean
  via: 'star' | 'local' | 'vision'
}

const MAX_TEXT_CHARS = 60_000

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.yaml', '.yml', '.xml', '.html', '.htm',
  '.log', '.ini', '.toml', '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h',
  '.cs', '.php', '.rb', '.sh', '.ps1', '.sql', '.css', '.scss', '.vue', '.svelte', '.srt', '.vtt',
])

const DOC_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.epub': 'application/epub+zip',
  '.rtf': 'application/rtf',
}

function requireToken(): string {
  const session = readStarSession()
  if (!session) throw new StarApiError('请先登录 STAR 账号（左下角头像 → 登录）', 401, 'STAR_SIGNED_OUT')
  return session.token
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function truncate(text: string, limit = MAX_TEXT_CHARS): { text: string; truncated: boolean } {
  return text.length > limit ? { text: text.slice(0, limit), truncated: true } : { text, truncated: false }
}

/**
 * Run one of the account service's capability skills (`/skills/:id/execute`).
 * The research skills only read (a search, a page), so a request whose
 * connection dropped is sent again instead of failing the agent's step.
 */
async function runSkill(id: string, parameters: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
  return record(await starRequest('POST', `/skills/${encodeURIComponent(id)}/execute`, {
    token: requireToken(),
    body: { parameters },
    timeoutMs,
    retryOnDisconnect: true,
  }))
}

/** Free web search (SearXNG with Bing fallback on the service side). */
export async function starWebSearch(query: string, maxResults = 8): Promise<StarWebSearchResult> {
  const text = query.trim()
  if (!text) throw new StarApiError('请输入搜索内容', 400, 'STAR_BAD_QUERY')
  const started = Date.now()
  const size = Math.min(20, Math.max(1, Math.round(maxResults)))
  const payload = await runSkill('web-search', { query: text.slice(0, 300), max_results: String(size) }, 60_000)
  const seen = new Set<string>()
  const results: StarSearchHit[] = []
  for (const item of Array.isArray(payload.results) ? payload.results : []) {
    const entry = record(item)
    const url = str(entry.url) || str(entry.link)
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    results.push({ title: str(entry.title) || url, url, snippet: str(entry.snippet) || str(entry.content) })
  }
  return { query: text, results: results.slice(0, size), latencyMs: Date.now() - started }
}

export async function starAcademicSearch(query: string, count = 8): Promise<StarAcademicResult> {
  const text = query.trim()
  if (!text) throw new StarApiError('请输入检索关键词', 400, 'STAR_BAD_QUERY')
  const started = Date.now()
  const size = Math.min(20, Math.max(1, Math.round(count)))
  const payload = record(await starRequest('POST', '/search/academic', {
    token: requireToken(),
    body: { query: text, count: size },
    timeoutMs: 90_000,
    // A search reads only: a dropped connection is retried.
    retryOnDisconnect: true,
  }))
  const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.results) ? payload.results : []
  const papers = items.map((item): StarPaper => {
    const entry = record(item)
    return {
      title: str(entry.name) || str(entry.title),
      url: str(entry.url) || str(entry.link),
      summary: str(entry.summary) || str(entry.snippet) || str(entry.abstract),
      source: str(entry.siteName) || str(entry.source) || str(entry.venue),
      year: str(entry.dateLastCrawled) || str(entry.year) || str(entry.publishedAt),
    }
  }).filter(paper => paper.title)
  return {
    query: text,
    total: typeof payload.totalEstimatedMatches === 'number' ? payload.totalEstimatedMatches : papers.length,
    papers: papers.slice(0, size),
    latencyMs: Date.now() - started,
  }
}

/** Fetch a page and answer about it (the service's `web-read` skill, billed as a chat turn). */
export async function starReadUrl(url: string, question?: string): Promise<{ title: string; url: string; answer: string; model: string }> {
  const target = url.trim()
  if (!/^https?:\/\//i.test(target)) throw new StarApiError('请输入 http(s) 网址', 400, 'STAR_BAD_URL')
  const payload = await runSkill('web-read', {
    url: target,
    ...(question?.trim() ? { instruction: question.trim() } : {}),
  }, 120_000)
  return {
    title: str(payload.title),
    url: str(payload.url) || target,
    answer: str(payload.text) || str(payload.answer) || str(payload.content),
    model: str(payload.model),
  }
}

/** Vision-capable chat models, cheapest first; the catalog does not flag vision itself. */
export const STAR_VISION_MODELS = ['gemini-2.5-flash', 'gemini-3-flash', 'gemini-3.8-flash', 'gpt-4.1-mini', 'gpt-5-mini', 'gpt-4o-mini']

/**
 * The relay prepends its own consultant prompt to tool-less chat requests,
 * so understanding requests carry one inert tool and `tool_choice: none`.
 */
const INERT_TOOL = {
  type: 'function',
  function: { name: 'noop', description: 'Unused.', parameters: { type: 'object', properties: {} } },
}

/** Ask a multimodal model about images (local paths, data URLs or http URLs) through the account relay. */
export async function starVision(input: {
  question: string
  images: string[]
  model?: string
  cwd?: string
}): Promise<{ answer: string; model: string; latencyMs: number }> {
  const question = input.question.trim()
  if (!question) throw new StarApiError('请填写要问的问题', 400, 'STAR_BAD_QUESTION')
  if (!input.images.length) throw new StarApiError('请提供至少一张图片', 400, 'STAR_NO_IMAGE')
  const session = readStarSession()
  if (!session) throw new StarApiError('请先登录 STAR 账号（左下角头像 → 登录）', 401, 'STAR_SIGNED_OUT')
  const relayKey = await ensureStarRelayKey()
  const started = Date.now()
  const urls = await publishStarReferences(input.images, 'image', session.token, 8, { cwd: input.cwd })
  const offered = new Set(readStarCatalog()?.chat.map(model => model.id) ?? [])
  const model = input.model?.trim() || STAR_VISION_MODELS.find(id => !offered.size || offered.has(id)) || STAR_VISION_MODELS[0]!
  let response: Response
  try {
    response = await fetch(`${starRelayBaseUrl(loadStarSettings())}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${relayKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        max_tokens: 2048,
        tools: [INERT_TOOL],
        tool_choice: 'none',
        messages: [
          { role: 'system', content: '你是严谨的视觉理解助手。只根据图片中能看到的内容作答，看不清的地方直说。' },
          { role: 'user', content: [{ type: 'text', text: question }, ...urls.map(url => ({ type: 'image_url', image_url: { url } }))] },
        ],
      }),
      signal: AbortSignal.timeout(150_000),
    })
  } catch (error) {
    throw new StarApiError(`STAR 对话中转不可达：${error instanceof Error ? error.message : String(error)}`, 502, 'STAR_UNREACHABLE')
  }
  const payload = record(await response.json().catch(() => ({})))
  if (!response.ok) {
    const error = record(payload.error)
    throw new StarApiError(str(error.message) || str(payload.message) || `识图失败（${response.status}）`, response.status, 'STAR_VISION_FAILED')
  }
  const choice = record(Array.isArray(payload.choices) ? payload.choices[0] : null)
  const answer = str(record(choice.message).content)
  if (!answer) throw new StarApiError('模型没有返回识别结果', 502, 'STAR_VISION_EMPTY')
  return { answer, model, latencyMs: Date.now() - started }
}

function readSource(source: string, cwd?: string): { bytes: Uint8Array; filename: string } {
  const resolved = path.isAbsolute(source) ? source : path.resolve(cwd ?? process.cwd(), source)
  let stat: fs.Stats
  try {
    stat = fs.statSync(resolved)
  } catch {
    throw new StarApiError(`找不到文件：${source}`, 400, 'STAR_FILE_NOT_FOUND')
  }
  if (!stat.isFile()) throw new StarApiError(`不是文件：${source}`, 400, 'STAR_FILE_NOT_FOUND')
  return { bytes: new Uint8Array(fs.readFileSync(resolved)), filename: path.basename(resolved) }
}

async function fetchSource(url: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new StarApiError(`文件无法下载（HTTP ${response.status}）`, 400, 'STAR_FILE_NOT_FOUND')
  const name = path.basename(new URL(url).pathname) || 'document'
  return { bytes: new Uint8Array(await response.arrayBuffer()), filename: decodeURIComponent(name) }
}

function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    return new TextDecoder('gb18030').decode(bytes)
  } catch {
    return utf8
  }
}

/**
 * Recognise a document (PDF, Word, Excel, PowerPoint, text…) into text.
 * STAR's parser serves members; plain-text formats fall back to a local read,
 * and other formats report why the server refused.
 */
export async function starExtractFile(source: string, options: { cwd?: string } = {}): Promise<StarExtractResult> {
  const value = source.trim().replace(/^file:\/\//i, '')
  if (!value) throw new StarApiError('请提供文件路径或网址', 400, 'STAR_FILE_NOT_FOUND')
  const { bytes, filename } = /^https?:\/\//i.test(value) ? await fetchSource(value) : readSource(value, options.cwd)
  return starExtractBytes(bytes, filename)
}

/** Same as {@link starExtractFile} for content already in memory (desktop uploads). */
export async function starExtractBytes(bytes: Uint8Array, filename: string): Promise<StarExtractResult> {
  const ext = path.extname(filename).toLowerCase()
  const local = (): StarExtractResult => {
    const { text, truncated } = truncate(decodeText(bytes))
    return { text, type: ext.slice(1) || 'text', filename, truncated, via: 'local' }
  }
  try {
    const payload = await starUpload('extract', requireToken(), bytes, filename, DOC_MIME[ext] ?? 'application/octet-stream', { timeoutMs: 180_000 })
    const { text, truncated } = truncate(str(payload.text))
    return { text, type: str(payload.type) || ext.slice(1), filename: str(payload.filename) || filename, truncated, via: 'star' }
  } catch (error) {
    if (TEXT_EXTENSIONS.has(ext)) return local()
    if (error instanceof StarApiError && error.status === 403) {
      throw new StarApiError(
        `${error.message}。非会员可以改用 Read 工具直接读取该文件（PDF/图片均支持），或开通会员后使用云端解析。`,
        403,
        'STAR_EXTRACT_MEMBERS_ONLY',
      )
    }
    throw error
  }
}

/** Tiny solid-colour PNG for capability checks (no network, no files). */
export function solidPngDataUrl(rgb: [number, number, number], size = 32): string {
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc32 = (data: Uint8Array) => {
    let c = 0xffffffff
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const header = new Uint8Array(13)
  const headerView = new DataView(header.buffer)
  headerView.setUint32(0, size)
  headerView.setUint32(4, size)
  header.set([8, 2, 0, 0, 0], 8)
  const raw = new Uint8Array(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1)
    for (let x = 0; x < size; x++) raw.set(rgb, row + 1 + x * 3)
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ]
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`
}
