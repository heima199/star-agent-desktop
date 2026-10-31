/**
 * HTTP client for the STAR application API (`{base}/api/...`, `x-app-secret`).
 */

import { absoluteStarUrl, loadStarSettings, type StarSettings } from './starConfig.js'

export class StarApiError extends Error {
  constructor(
    message: string,
    public status = 502,
    public code = 'STAR_ERROR',
  ) {
    super(message)
    this.name = 'StarApiError'
  }
}

/** Pull a human message out of the service's error envelopes. */
export function starErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    let raw: unknown = record.message ?? record.error
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) raw = (raw as Record<string, unknown>).message
    if (Array.isArray(raw)) return raw.map(String).join('；')
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
  }
  if (typeof payload === 'string' && payload.trim()) return payload.trim().slice(0, 300)
  return fallback
}

export type StarRequestOptions = {
  token?: string | null
  body?: unknown
  timeoutMs?: number
  settings?: StarSettings
  signal?: AbortSignal
  /**
   * Send again, on a fresh connection, when the connection drops before an
   * answer arrives. On by default for GET and HEAD. A request with an effect
   * (an order, a generation job, a check-in) opts in only where repeating it
   * is harmless, which is why the default is off for everything else.
   */
  retryOnDisconnect?: boolean
}

/** Waits before each repeat of a request whose connection dropped. */
const RECONNECT_DELAYS_MS = [400, 1_500]

/** Bun and undici codes for a connection closed or refused under a request. */
const DISCONNECT_CODES = new Set(['ConnectionClosed', 'ConnectionRefused', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET'])

/**
 * Whether `error` is the connection going away (a pooled socket the service
 * already closed, a proxy cutting a long request) rather than an answer, a
 * timeout or a cancel. Bun words the first as "The socket connection was
 * closed unexpectedly".
 */
export function isStarDisconnect(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === 'TimeoutError' || error.name === 'AbortError') return false
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && DISCONNECT_CODES.has(code)) return true
  const cause = (error as { cause?: unknown }).cause
  if (cause && cause !== error && isStarDisconnect(cause)) return true
  return /socket connection was closed|socket hang up|other side closed|connection reset|ECONNRESET|EPIPE/i.test(error.message)
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}

/**
 * `fetch`, sent again on a fresh connection when the connection drops before
 * an answer (at most RECONNECT_DELAYS_MS.length more times, all within the one
 * `timeoutMs`). That is what recovers a request from a pooled socket the
 * service had already closed, the cause of most "STAR 服务不可达" failures.
 */
async function fetchWithReconnect(url: string, init: RequestInit, timeoutMs: number, retry: boolean, signal?: AbortSignal): Promise<Response> {
  const deadline = Date.now() + timeoutMs
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now()
    try {
      return await fetch(url, {
        ...init,
        // A repeat must not land on another pooled socket of the same kind.
        ...(attempt > 0 ? { keepalive: false } : {}),
        signal: timeoutSignal(Math.max(1, remaining), signal),
      })
    } catch (error) {
      const wait = RECONNECT_DELAYS_MS[attempt]
      const time = deadline - Date.now()
      if (!retry || wait === undefined || !isStarDisconnect(error) || signal?.aborted || time <= wait + 1_000) throw error
      await delay(wait, signal)
    }
  }
}

function requireSettings(settings?: StarSettings): StarSettings {
  const resolved = settings ?? loadStarSettings()
  if (!resolved.configured) {
    throw new StarApiError('STAR 应用密钥未配置，无法连接 STAR 服务', 503, 'STAR_NOT_CONFIGURED')
  }
  return resolved
}

function headers(settings: StarSettings, token: string | null | undefined, json: boolean): Record<string, string> {
  const result: Record<string, string> = {
    Accept: 'application/json',
    'x-app-secret': settings.appSecret,
  }
  if (json) result['Content-Type'] = 'application/json'
  if (token) result.Authorization = `Bearer ${token}`
  return result
}

function timeoutSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([timeout, signal]) : timeout
}

async function readPayload(response: Response): Promise<unknown> {
  const raw = await response.text()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function networkError(error: unknown, what: string): StarApiError {
  if (error instanceof StarApiError) return error
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError') return new StarApiError(`${what}超时，请稍后重试`, 504, 'STAR_TIMEOUT')
  if (name === 'AbortError') return new StarApiError(`${what}已取消`, 499, 'STAR_ABORTED')
  const detail = error instanceof Error ? error.message : String(error)
  return new StarApiError(`STAR 服务不可达：${detail}`, 502, 'STAR_UNREACHABLE')
}

/** JSON request against `{base}/api{apiPath}`. */
export async function starRequest<T = unknown>(
  method: string,
  apiPath: string,
  options: StarRequestOptions = {},
): Promise<T> {
  const settings = requireSettings(options.settings)
  const url = `${settings.baseUrl}/api${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`
  const upper = method.toUpperCase()
  const retry = options.retryOnDisconnect ?? (upper === 'GET' || upper === 'HEAD')
  let response: Response
  try {
    response = await fetchWithReconnect(url, {
      method,
      headers: headers(settings, options.token, options.body !== undefined),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }, options.timeoutMs ?? 30_000, retry, options.signal)
  } catch (error) {
    throw networkError(error, '请求 STAR 服务')
  }
  const payload = await readPayload(response)
  if (!response.ok) {
    throw new StarApiError(
      starErrorMessage(payload, `STAR 服务返回 ${response.status}`),
      response.status,
      response.status === 401 ? 'STAR_UNAUTHORIZED' : 'STAR_UPSTREAM',
    )
  }
  return payload as T
}

export type StarUploadKind = 'image' | 'video' | 'audio' | 'file' | 'extract'

const UPLOAD_LIMITS: Record<StarUploadKind, number> = {
  image: 10 * 1024 * 1024,
  video: 64 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  file: 50 * 1024 * 1024,
  extract: 50 * 1024 * 1024,
}

/** Multipart upload to `/api/upload/{kind}`. Returns the parsed JSON body. */
export async function starUpload(
  kind: StarUploadKind,
  token: string,
  data: Uint8Array,
  filename: string,
  mime: string,
  options: { settings?: StarSettings; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Record<string, unknown>> {
  const settings = requireSettings(options.settings)
  if (!data.byteLength) throw new StarApiError('上传的文件是空的', 400, 'STAR_EMPTY_UPLOAD')
  const limit = UPLOAD_LIMITS[kind]
  if (data.byteLength > limit) {
    throw new StarApiError(`文件超过 ${Math.round(limit / 1024 / 1024)}MB 上限，请压缩后再试`, 400, 'STAR_UPLOAD_TOO_LARGE')
  }
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(data)], { type: mime }), filename)
  let response: Response
  try {
    response = await fetch(`${settings.baseUrl}/api/upload/${kind}`, {
      method: 'POST',
      headers: headers(settings, token, false),
      body: form,
      signal: timeoutSignal(options.timeoutMs ?? 120_000, options.signal),
    })
  } catch (error) {
    throw networkError(error, '上传文件')
  }
  const payload = await readPayload(response)
  if (!response.ok) {
    throw new StarApiError(starErrorMessage(payload, `上传失败 (${response.status})`), response.status, 'STAR_UPLOAD_FAILED')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new StarApiError('上传后服务没有返回结果', 502, 'STAR_UPLOAD_FAILED')
  }
  return payload as Record<string, unknown>
}

/** Upload and return the public URL the media models can fetch. */
export async function starUploadForUrl(
  kind: 'image' | 'video' | 'audio' | 'file',
  token: string,
  data: Uint8Array,
  filename: string,
  mime: string,
  options: { settings?: StarSettings; signal?: AbortSignal } = {},
): Promise<string> {
  const settings = options.settings ?? loadStarSettings()
  const payload = await starUpload(kind, token, data, filename, mime, { ...options, settings })
  const raw = typeof payload.url === 'string' ? payload.url : typeof payload.fileUrl === 'string' ? payload.fileUrl : ''
  const url = absoluteStarUrl(raw, settings)
  if (!/^https?:\/\//i.test(url)) throw new StarApiError('上传后没有返回可访问的地址', 502, 'STAR_UPLOAD_FAILED')
  return url
}
