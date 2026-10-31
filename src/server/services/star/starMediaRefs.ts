/**
 * Turn the references a user or agent supplies — local paths, data URLs or
 * http(s) URLs — into public URLs the STAR media models can fetch.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { StarApiError, starUploadForUrl } from './starClient.js'

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const VIDEO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
}

const DATA_URL_RE = /^data:([^;,]+)?(;base64)?,(.*)$/s

function isLoopbackUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  } catch {
    return false
  }
}

function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

function extensionFor(mime: string): string {
  const entry = Object.entries({ ...IMAGE_MIME, ...VIDEO_MIME }).find(([, value]) => value === mime)
  return entry?.[0] ?? '.bin'
}

async function readReference(raw: string, kind: 'image' | 'video', cwd?: string): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  const dataMatch = DATA_URL_RE.exec(raw)
  if (dataMatch) {
    const mime = (dataMatch[1] || (kind === 'image' ? 'image/png' : 'video/mp4')).toLowerCase()
    const body = dataMatch[3] ?? ''
    const bytes = dataMatch[2] ? Uint8Array.from(Buffer.from(body, 'base64')) : new TextEncoder().encode(decodeURIComponent(body))
    return { bytes, mime, name: `reference${extensionFor(mime)}` }
  }
  if (/^https?:\/\//i.test(raw)) {
    const response = await fetch(raw, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new StarApiError(`参考文件无法读取（HTTP ${response.status}）`, 400, 'STAR_BAD_REFERENCE')
    const mime = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    const bytes = new Uint8Array(await response.arrayBuffer())
    return { bytes, mime, name: path.basename(new URL(raw).pathname) || `reference${extensionFor(mime)}` }
  }
  const resolved = path.isAbsolute(raw) ? raw : path.resolve(cwd ?? process.cwd(), raw)
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(fs.readFileSync(resolved))
  } catch {
    throw new StarApiError(`找不到参考文件：${raw}`, 400, 'STAR_BAD_REFERENCE')
  }
  const ext = path.extname(resolved).toLowerCase()
  const mime = (kind === 'image' ? IMAGE_MIME[ext] : VIDEO_MIME[ext]) ?? ''
  return { bytes, mime, name: path.basename(resolved) }
}

/** Public URL for one reference; uploads local and loopback content first. */
export async function publishStarReference(
  raw: string,
  kind: 'image' | 'video',
  token: string,
  options: { cwd?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const value = raw.trim().replace(/^file:\/\//i, '')
  if (!value) throw new StarApiError('参考文件地址为空', 400, 'STAR_BAD_REFERENCE')
  if (/^https?:\/\//i.test(value) && !isLoopbackUrl(value)) return value
  const { bytes, mime, name } = await readReference(value, kind, options.cwd)
  if (kind === 'image') {
    const sniffed = sniffImageMime(bytes)
    if (!sniffed) throw new StarApiError(`参考图不是 PNG/JPG/WebP/GIF 图片：${raw}`, 400, 'STAR_BAD_REFERENCE')
    return starUploadForUrl('image', token, bytes, name.includes('.') ? name : `${name}${extensionFor(sniffed)}`, sniffed, options)
  }
  const videoMime = mime.startsWith('video/') ? mime : VIDEO_MIME[path.extname(name).toLowerCase()] ?? 'video/mp4'
  return starUploadForUrl('video', token, bytes, name, videoMime, options)
}

export async function publishStarReferences(
  refs: readonly string[] | undefined,
  kind: 'image' | 'video',
  token: string,
  limit: number,
  options: { cwd?: string; signal?: AbortSignal } = {},
): Promise<string[]> {
  const unique = [...new Set((refs ?? []).map(item => item.trim()).filter(Boolean))]
  if (unique.length > limit) throw new StarApiError(`参考${kind === 'image' ? '图' : '视频'}最多 ${limit} 个`, 400, 'STAR_TOO_MANY_REFERENCES')
  const urls: string[] = []
  for (const ref of unique) urls.push(await publishStarReference(ref, kind, token, options))
  return [...new Set(urls)]
}
