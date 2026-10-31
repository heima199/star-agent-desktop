import { MCP_SNAPSHOT_REPLY, MCP_SNAPSHOT_REQUEST, sanitizeSnapshotHtml } from './mcpHtmlUi'

/**
 * Pictures of an MCP tool's live view, for 添加快照到对话: the page as it is
 * now is asked from the view's frame (see withSnapshotBridge) and drawn into a
 * PNG the composer takes like a pasted picture.
 */

export type FrameSnapshot = { html: string; width: number; height: number }

/** Largest picture taken; a longer page is cut at the bottom. */
export const SNAPSHOT_MAX_WIDTH = 1600
export const SNAPSHOT_MAX_HEIGHT = 2400
const MAX_SNAPSHOT_HTML_CHARS = 4_000_000

/**
 * The current page of the view in `frame`, or null when it does not answer in
 * `timeoutMs` (a page whose security policy blocks the bridge): the caller
 * then draws the page as the tool sent it.
 */
export function requestFrameSnapshot(frame: HTMLIFrameElement, timeoutMs = 1500): Promise<FrameSnapshot | null> {
  const target = frame.contentWindow
  if (!target) return Promise.resolve(null)
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  return new Promise((resolve) => {
    const finish = (value: FrameSnapshot | null) => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
      resolve(value)
    }
    // Only this frame's answer to this request counts; the page itself is untrusted.
    const onMessage = (event: MessageEvent) => {
      if (event.source !== target) return
      const data = event.data as { type?: unknown; id?: unknown; html?: unknown; width?: unknown; height?: unknown } | null
      if (!data || data.type !== MCP_SNAPSHOT_REPLY || data.id !== id) return
      if (typeof data.html !== 'string' || data.html.length > MAX_SNAPSHOT_HTML_CHARS) return
      finish({ html: data.html, width: Number(data.width) || 0, height: Number(data.height) || 0 })
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    window.addEventListener('message', onMessage)
    target.postMessage({ type: MCP_SNAPSHOT_REQUEST, id }, '*')
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value) || min))
}

/**
 * `html` drawn `width` × `height` (within the limits above) as a PNG data URL.
 * It is cleaned first and drawn in a hidden frame that runs no scripts.
 */
export async function renderHtmlSnapshot(html: string, width: number, height: number): Promise<string> {
  const w = clamp(width, 200, SNAPSHOT_MAX_WIDTH)
  const h = clamp(height, 120, SNAPSHOT_MAX_HEIGHT)
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = `position:fixed;left:-${w + 100}px;top:0;width:${w}px;height:${h}px;border:0;visibility:hidden;pointer-events:none`
  document.body.appendChild(frame)
  try {
    await new Promise<void>((resolve) => {
      frame.onload = () => resolve()
      frame.srcdoc = sanitizeSnapshotHtml(html)
    })
    const doc = frame.contentDocument
    if (!doc) throw new Error('The snapshot frame could not be read')
    await doc.fonts?.ready.catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 120))
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(doc.documentElement, {
      width: w, height: h, windowWidth: w, windowHeight: h, scale: 1, useCORS: true, backgroundColor: '#ffffff', logging: false,
    })
    return canvas.toDataURL('image/png')
  } finally {
    frame.remove()
  }
}
