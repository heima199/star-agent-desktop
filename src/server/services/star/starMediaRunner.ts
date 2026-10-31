/**
 * Low-level pieces of a STAR media job: task updates broadcast in-process,
 * submission parsing, polling `/{kind}/tasks/:id` and downloading results.
 */

import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { StarApiError, starRequest } from './starClient.js'
import { absoluteStarUrl } from './starConfig.js'
import {
  saveStarTask,
  starOutputsDir,
  type StarMediaKind,
  type StarMediaOutput,
  type StarMediaTask,
} from './starMediaStore.js'

const POLL_MS: Record<StarMediaKind, number> = { image: 4_000, video: 8_000 }
const DEADLINE_MS: Record<StarMediaKind, number> = { image: 10 * 60_000, video: 40 * 60_000 }
const EXPECTED_MS: Record<StarMediaKind, number> = { image: 45_000, video: 240_000 }
const FAILED = new Set(['failed', 'error', 'canceled', 'cancelled', 'timeout'])
const DONE = new Set(['success', 'succeeded', 'completed', 'done', 'finished'])

export const FINAL_STATUSES = new Set(['succeeded', 'failed'])

const events = new EventEmitter()
events.setMaxListeners(500)

export function onStarTaskEvent(listener: (task: StarMediaTask) => void): () => void {
  events.on('task', listener)
  return () => events.off('task', listener)
}

/** Merge a patch, persist it and tell listeners. Returns the same object. */
export function updateStarTask(task: StarMediaTask, patch: Partial<StarMediaTask>): StarMediaTask {
  Object.assign(task, patch)
  const saved = saveStarTask(task)
  task.updatedAt = saved.updatedAt
  events.emit('task', { ...task })
  return task
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function asUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const url = absoluteStarUrl(value.trim())
  return /^https?:\/\//i.test(url) ? url : null
}

/** Result URLs in a task payload, under any of the field names the service uses. */
export function resultUrls(payload: Record<string, unknown>, kind: StarMediaKind): string[] {
  const keys = kind === 'image'
    ? ['imageUrl', 'url', 'resultUrl', 'outputUrl']
    : ['videoUrl', 'url', 'resultUrl', 'outputUrl']
  const urls: string[] = []
  for (const key of keys) {
    const url = asUrl(payload[key])
    if (url) urls.push(url)
  }
  for (const key of kind === 'image' ? ['imageUrls', 'urls', 'resultUrls'] : ['videoUrls', 'urls', 'resultUrls']) {
    const list = payload[key]
    if (Array.isArray(list)) for (const item of list) {
      const url = asUrl(item)
      if (url) urls.push(url)
    }
  }
  return [...new Set(urls)]
}

export type StarSubmission = { id: string | null; urls: string[] }

export function parseSubmission(payload: unknown, kind: StarMediaKind): StarSubmission {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const urls = resultUrls(record, kind)
  const rawId = record.id ?? record.taskId ?? record.task_id
  const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId).trim() : ''
  const status = String(record.status ?? '').toLowerCase()
  if (!urls.length && (!id || FAILED.has(status))) {
    const reason = record.error ?? record.errorMessage ?? record.message
    throw new StarApiError(typeof reason === 'string' && reason.trim() ? reason.trim() : '服务没有返回任务', 502, 'STAR_MEDIA_SUBMIT')
  }
  return { id: id || null, urls }
}

/**
 * Poll one remote task until it has result URLs. `onProgress` gets a 0–1
 * fraction: the service's own `progress` when reported, else elapsed time
 * against a typical duration.
 */
export async function pollRemoteTask(
  kind: StarMediaKind,
  remoteId: string,
  token: string,
  onProgress: (fraction: number) => void,
): Promise<string[]> {
  const started = Date.now()
  let failures = 0
  for (;;) {
    await sleep(POLL_MS[kind])
    let payload: Record<string, unknown>
    try {
      payload = await starRequest<Record<string, unknown>>('GET', `/${kind}/tasks/${encodeURIComponent(remoteId)}`, { token, timeoutMs: 30_000 })
      failures = 0
    } catch (error) {
      if (error instanceof StarApiError && [400, 401, 403, 404].includes(error.status)) throw error
      failures += 1
      if (failures >= 6) throw error
      continue
    }
    const status = String(payload?.status ?? '').toLowerCase()
    if (FAILED.has(status)) {
      const reason = payload.error ?? payload.errorMessage ?? payload.failReason ?? payload.message
      throw new StarApiError(typeof reason === 'string' && reason.trim() ? reason.trim() : '生成失败', 502, 'STAR_MEDIA_FAILED')
    }
    const urls = resultUrls(payload, kind)
    if (urls.length) return urls
    if (DONE.has(status)) throw new StarApiError('生成完成但服务没有返回文件地址', 502, 'STAR_MEDIA_NO_URL')
    const reported = num(payload.progress)
    const elapsed = Date.now() - started
    const fraction = reported !== undefined
      ? Math.min(0.99, Math.max(0, reported > 1 ? reported / 100 : reported))
      : Math.min(0.95, elapsed / EXPECTED_MS[kind])
    onProgress(fraction)
    if (elapsed > DEADLINE_MS[kind]) {
      throw new StarApiError(`${kind === 'image' ? '图片' : '视频'}生成超时，任务可能仍在服务端进行`, 504, 'STAR_MEDIA_TIMEOUT')
    }
  }
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
}

function extensionFor(url: string, mime: string, kind: StarMediaKind): string {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase()
    if (/^\.(png|jpe?g|webp|gif|mp4|mov|webm)$/.test(ext)) return ext === '.jpeg' ? '.jpg' : ext
  } catch {
    // Fall through to the content type.
  }
  return EXT_BY_MIME[mime] ?? (kind === 'image' ? '.png' : '.mp4')
}

function uniquePath(dir: string, name: string): string {
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let candidate = path.join(dir, name)
  for (let index = 2; fs.existsSync(candidate); index++) candidate = path.join(dir, `${stem}-${index}${ext}`)
  return candidate
}

function stamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** Where outputs go: an explicit directory, `<cwd>/star-outputs`, or the app's own folder. */
export function resolveOutputDir(saveDir: string | undefined, cwd: string | undefined): string {
  const explicit = saveDir?.trim()
  if (explicit) return path.resolve(cwd ?? process.cwd(), explicit)
  if (cwd) return path.join(cwd, 'star-outputs')
  return starOutputsDir()
}

/** Download every URL; a URL that fails to download is kept as a remote-only output. */
export async function downloadOutputs(task: StarMediaTask, urls: string[], dir: string): Promise<StarMediaOutput[]> {
  const outputs: StarMediaOutput[] = []
  const base = `${task.kind}-${stamp()}-${task.id.slice(-4)}`
  for (const [index, url] of urls.entries()) {
    const name = urls.length > 1 ? `${base}-${index + 1}` : base
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(task.kind === 'video' ? 600_000 : 180_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const mime = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
      const bytes = new Uint8Array(await response.arrayBuffer())
      fs.mkdirSync(dir, { recursive: true })
      const file = uniquePath(dir, `${name}${extensionFor(url, mime, task.kind)}`)
      fs.writeFileSync(file, bytes)
      outputs.push({ kind: task.kind, url, file, name: path.basename(file) })
    } catch {
      outputs.push({ kind: task.kind, url, name: `${name}${extensionFor(url, '', task.kind)}` })
    }
  }
  return outputs
}
