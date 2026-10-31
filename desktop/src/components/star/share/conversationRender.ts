/**
 * Draws a shared conversation. The transcript is laid out off screen, then
 * html2canvas paints it in pieces no canvas can choke on: one picture for the
 * long image, A4 pages for the PDF. What goes in and where to cut is decided by
 * the pure functions in conversationExport.ts.
 */
import html2canvas, { type Options as Html2CanvasOptions } from 'html2canvas'
import DOMPurify from 'dompurify'
import { Marked, type Tokens } from 'marked'

import { apiGetBlob, getBaseUrl } from '@/api/client'
import { attachmentImageSource } from '@/lib/attachmentImages'
import { buildImagePdf, canvasToJpeg, pdfBlob, type PdfImagePage } from '@/lib/imagePdf'
import { createAssistantMarkdownImageResolver, normalizeMarkdownImageDestination } from '@/lib/markdownImages'
import { getStarBrandName } from '@/stores/starBrandStore'
import {
  a4PageHeight,
  buildTranscriptHtml,
  estimatePageCount,
  findBlankRow,
  formatShareTime,
  imageSlotHtml,
  missingImageHtml,
  missingImageText,
  planLongImage,
  planSegments,
  type RenderSegment,
  type ShareRound,
} from './conversationExport'

export type ShareDocument = {
  sessionId: string
  /** The session's workspace root, for local pictures a reply points at. */
  workDir: string | null
  title: string
  rounds: readonly ShareRound[]
  startedAt: Date | null
}

export type LongImageResult = {
  blob: Blob
  width: number
  height: number
  /** Rounds in the picture, and in the conversation. */
  rounds: number
  totalRounds: number
  truncated: boolean
  /** Not even the first round fitted: the picture holds its beginning only. */
  partial: boolean
}

export type PdfProgress = { page: number; total: number }

type RenderOptions = { signal?: AbortSignal; now?: Date }

/** CSS width of the transcript. */
const SHARE_WIDTH = 720
const SCALE = 2
/** Limits per html2canvas call. Chromium allows more, but not on every GPU and not without long stalls. */
const MAX_CANVAS_HEIGHT = 16_000
const MAX_CANVAS_AREA = 120_000_000
/** The tallest piece one html2canvas call draws, in CSS px. */
const MAX_RENDER_HEIGHT = Math.floor(Math.min(MAX_CANVAS_HEIGHT, MAX_CANVAS_AREA / (SHARE_WIDTH * SCALE)) / SCALE)
/** A PDF segment stops growing at about two pages, so the progress line moves page by page. */
const PDF_SEGMENT_TARGET = 1_800
/** Pictures loaded per export; the rest show as 「[图片]」. */
const MAX_IMAGES = 12
/** Blank band above and below each PDF page's content, in canvas px. */
const PAGE_MARGIN = 64
/** How far up from a page's bottom a break may move to land between two lines. */
const BREAK_SCAN = 0.22
/** STAR's upload limit. */
const UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024

const CANVAS_OPTIONS: Partial<Html2CanvasOptions> = {
  scale: SCALE,
  width: SHARE_WIDTH,
  backgroundColor: '#ffffff',
  useCORS: true,
  logging: false,
  imageTimeout: 15_000,
}

/**
 * No pictures but the ones loaded here: a raw `<img>` in a reply would fetch a
 * remote URL the moment it is mounted. A reply's own classes, ids and styles
 * must not pick up the app's stylesheet or collide with its ids.
 */
const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'img', 'picture', 'source', 'video', 'audio', 'iframe', 'object', 'embed', 'form', 'button', 'select', 'textarea', 'link', 'meta'],
  FORBID_ATTR: ['style', 'class', 'id'],
}

// Exports run one at a time: each lays out its own copy of the transcript and holds large canvases.
let queue: Promise<unknown> = Promise.resolve()
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  // Large canvases hold their memory until they shrink or are collected.
  canvas.width = 0
  canvas.height = 0
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the picture'))), type, quality)
  })
}

/**
 * Pictures fetched for one share dialog, as blob URLs reused across re-renders
 * and revoked together. Local-server pictures go through `apiGetBlob`, the
 * authenticated channel (an `<img>` pointed at the API fails in the packaged
 * app); nothing remote is fetched.
 */
export class ShareImageCache {
  private readonly entries = new Map<string, Promise<string | null>>()
  private readonly urls = new Set<string>()
  private disposed = false

  load(source: string): Promise<string | null> {
    if (/^(?:data|blob):/i.test(source)) return Promise.resolve(source)
    const cached = this.entries.get(source)
    if (cached) return cached
    const base = getBaseUrl().replace(/\/+$/, '')
    const entry = source.startsWith(`${base}/`)
      ? apiGetBlob(source.slice(base.length), { timeout: 20_000 }).then((blob) => {
          if (this.disposed || !blob.size) return null
          const url = URL.createObjectURL(blob)
          this.urls.add(url)
          return url
        }, () => null)
      : Promise.resolve(null)
    this.entries.set(source, entry)
    return entry
  }

  dispose() {
    this.disposed = true
    for (const url of this.urls) URL.revokeObjectURL(url)
    this.urls.clear()
    this.entries.clear()
  }
}

/** Its own parser: MarkdownRenderer configures the global `marked`, which must not leak in here. */
function createMarkdownRenderer(imageHtml: (href: string, alt: string) => string): (markdown: string) => string {
  const marked = new Marked({ gfm: true, breaks: true })
  marked.use({
    renderer: {
      image(token: Tokens.Image) {
        // A Windows path or a file URL would not survive sanitization as written (see markdownImages.ts).
        return imageHtml(normalizeMarkdownImageDestination(token.href, token.raw), token.text)
      },
    },
  })
  return (markdown) => DOMPurify.sanitize(marked.parse(markdown, { async: false }), SANITIZE_CONFIG)
}

type Mounted = {
  host: HTMLDivElement
  /** Header, blocks and footer, top to bottom. */
  items: HTMLElement[]
  rounds: HTMLElement[]
  note: HTMLElement | null
}

async function fillImageSlots(host: HTMLElement, sources: readonly string[], images: ShareImageCache) {
  const slots = Array.from(host.querySelectorAll<HTMLElement>('[data-share-src]'))
  await Promise.all(slots.map(async (slot) => {
    const name = slot.dataset.shareName ?? ''
    const source = sources[Number(slot.dataset.shareSrc)]
    const url = source ? await images.load(source) : null
    if (url) {
      const picture = document.createElement('img')
      picture.setAttribute('data-share-pic', '')
      picture.alt = name
      picture.src = url
      try {
        await picture.decode()
        slot.replaceWith(picture)
        return
      } catch {
        // Not something the browser can draw; the placeholder below says a picture was here.
      }
    }
    const missing = document.createElement('span')
    missing.setAttribute('data-share-missing', '')
    missing.textContent = missingImageText(name)
    slot.replaceWith(missing)
  }))
}

async function mountTranscript(doc: ShareDocument, images: ShareImageCache, now: Date, signal?: AbortSignal): Promise<Mounted> {
  const prefix = `star-share-${Math.random().toString(36).slice(2, 10)}`
  const sources: string[] = []
  const slotBySource = new Map<string, number>()
  const slot = (source: string | null | undefined): number | null => {
    if (!source) return null
    const known = slotBySource.get(source)
    if (known !== undefined) return known
    if (sources.length >= MAX_IMAGES) return null
    sources.push(source)
    slotBySource.set(source, sources.length - 1)
    return sources.length - 1
  }
  // The resolver the transcript uses: local files only, never a network URL.
  const resolveReplyImage = createAssistantMarkdownImageResolver({ baseUrl: getBaseUrl(), sessionId: doc.sessionId, workDir: doc.workDir })
  const renderMarkdown = createMarkdownRenderer((href, alt) => {
    const index = slot(href ? resolveReplyImage(href) : null)
    return index === null ? missingImageHtml(alt) : imageSlotHtml(index, alt)
  })
  const meta = [doc.startedAt ? formatShareTime(doc.startedAt) : null, `${doc.rounds.length} 轮对话`].filter(Boolean).join(' · ')

  const host = document.createElement('div')
  host.className = prefix
  host.setAttribute('aria-hidden', 'true')
  // Off screen rather than hidden: html2canvas skips whatever is invisible.
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${SHARE_WIDTH}px;pointer-events:none;`
  host.innerHTML = buildTranscriptHtml({
    prefix,
    title: doc.title,
    meta,
    footer: `由 ${getStarBrandName()} 生成 · ${formatShareTime(now)}`,
    rounds: doc.rounds,
    renderMarkdown,
    attachmentSlot: (attachment) => slot(attachmentImageSource(attachment)),
  })
  document.body.appendChild(host)
  try {
    await fillImageSlots(host, sources, images)
    await document.fonts?.ready
    throwIfAborted(signal)
  } catch (error) {
    host.remove()
    throw error
  }
  return {
    host,
    items: Array.from(host.querySelectorAll<HTMLElement>('[data-share-item]')),
    rounds: Array.from(host.querySelectorAll<HTMLElement>('[data-share-round]')),
    note: host.querySelector<HTMLElement>('[data-share-note]'),
  }
}

/** Leaves the app itself out of html2canvas's document clone: only the transcript is drawn. */
function outsideHost(host: HTMLElement) {
  return (element: Element) => element.parentElement === document.body && element !== host
}

function heightOf(element: Element | null | undefined): number {
  return element ? element.getBoundingClientRect().height : 0
}

/**
 * The long image: the whole transcript when it fits one canvas, otherwise the
 * first rounds that do, with a line in the picture saying it was cut.
 */
export function renderLongImage(doc: ShareDocument, images: ShareImageCache, options: RenderOptions = {}): Promise<LongImageResult> {
  return exclusive(async () => {
    throwIfAborted(options.signal)
    const mounted = await mountTranscript(doc, images, options.now ?? new Date(), options.signal)
    try {
      let noteHeight = 0
      if (mounted.note) {
        mounted.note.textContent = '对话较长，长图只包含前 99 轮（共 999 轮）'
        mounted.note.hidden = false
        noteHeight = heightOf(mounted.note)
        mounted.note.hidden = true
      }
      const plan = planLongImage({
        header: heightOf(mounted.items[0]),
        rounds: mounted.rounds.map(heightOf),
        note: noteHeight,
        footer: heightOf(mounted.items[mounted.items.length - 1]),
        max: MAX_RENDER_HEIGHT,
      })
      mounted.rounds.forEach((round, index) => {
        round.hidden = index >= plan.rounds
      })
      const first = mounted.rounds[0]
      if (plan.clipFirstRound !== null && first) {
        first.style.maxHeight = `${plan.clipFirstRound}px`
        first.style.overflow = 'hidden'
      }
      if (plan.truncated && mounted.note) {
        mounted.note.textContent = plan.clipFirstRound !== null
          ? '对话较长，长图只包含第 1 轮的开头部分'
          : `对话较长，长图只包含前 ${plan.rounds} 轮（共 ${doc.rounds.length} 轮）`
        mounted.note.hidden = false
      }
      const height = Math.min(MAX_RENDER_HEIGHT, Math.ceil(heightOf(mounted.host)))
      throwIfAborted(options.signal)
      const canvas = await html2canvas(mounted.host, { ...CANVAS_OPTIONS, height, ignoreElements: outsideHost(mounted.host) })
      try {
        throwIfAborted(options.signal)
        const blob = await canvasBlob(canvas, 'image/png')
        return {
          blob,
          width: canvas.width,
          height: canvas.height,
          rounds: plan.rounds,
          totalRounds: doc.rounds.length,
          truncated: plan.truncated,
          partial: plan.clipFirstRound !== null,
        }
      } finally {
        releaseCanvas(canvas)
      }
    } finally {
      mounted.host.remove()
    }
  })
}

function renderSegment(mounted: Mounted, segment: RenderSegment): Promise<HTMLCanvasElement> {
  const kept = new Set<Element>(segment.kind === 'items'
    ? mounted.items.slice(segment.from, segment.to)
    : mounted.items.slice(segment.item, segment.item + 1))
  const outside = outsideHost(mounted.host)
  return html2canvas(mounted.host, {
    ...CANVAS_OPTIONS,
    // Only this segment's items are cloned, so the clone is exactly as tall as they are.
    ignoreElements: (element) => outside(element) || (element.hasAttribute('data-share-item') && !kept.has(element)),
    ...(segment.kind === 'slice' ? { y: segment.offset, height: segment.height } : {}),
  })
}

function blankPage(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas unavailable')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  return { canvas, context }
}

/**
 * Pours segment canvases into A4 pages, carrying what does not fit into the
 * next page. A break moves up to the lowest blank row near the page bottom so
 * no line of text is cut in half; failing that it cuts at the page edge.
 */
function createPageComposer(width: number, totalRows: number, onProgress: (progress: PdfProgress) => void) {
  const pageHeight = a4PageHeight(width)
  const contentHeight = pageHeight - PAGE_MARGIN * 2
  const pages: PdfImagePage[] = []
  let page = blankPage(width, pageHeight)
  let filled = 0
  let placed = 0

  const report = () => onProgress({
    page: pages.length + 1,
    total: estimatePageCount(pages.length, totalRows - placed, contentHeight),
  })

  const emit = async (rows: number) => {
    report()
    pages.push(await canvasToJpeg(page.canvas, 0.9))
    releaseCanvas(page.canvas)
    placed += rows
  }

  const lowestBlankRow = (scanRows: number): number | null => {
    try {
      const region = page.context.getImageData(0, PAGE_MARGIN + contentHeight - scanRows, width, scanRows)
      return findBlankRow(region.data, width, scanRows)
    } catch {
      return null
    }
  }

  const breakPage = async () => {
    const scanRows = Math.floor(contentHeight * BREAK_SCAN)
    const blank = lowestBlankRow(scanRows)
    const cut = blank === null ? contentHeight : contentHeight - scanRows + blank
    const carry = contentHeight - cut
    const next = blankPage(width, pageHeight)
    if (carry > 0) {
      next.context.drawImage(page.canvas, 0, PAGE_MARGIN + cut, width, carry, 0, PAGE_MARGIN, width, carry)
      page.context.fillStyle = '#ffffff'
      page.context.fillRect(0, PAGE_MARGIN + cut, width, carry)
    }
    await emit(cut)
    page = next
    filled = carry
  }

  return {
    report,
    async push(source: HTMLCanvasElement) {
      let from = 0
      while (from < source.height) {
        const take = Math.min(source.height - from, contentHeight - filled)
        page.context.drawImage(source, 0, from, source.width, take, 0, PAGE_MARGIN + filled, width, take)
        filled += take
        from += take
        if (filled >= contentHeight) await breakPage()
      }
    },
    async finish(): Promise<PdfImagePage[]> {
      if (filled > 0 || pages.length === 0) await emit(filled)
      else releaseCanvas(page.canvas)
      return pages
    },
  }
}

/** The whole transcript as an A4 PDF, reporting the page it is on. */
export function renderPdf(
  doc: ShareDocument,
  images: ShareImageCache,
  onProgress: (progress: PdfProgress) => void,
  options: RenderOptions = {},
): Promise<{ blob: Blob; pages: number }> {
  return exclusive(async () => {
    throwIfAborted(options.signal)
    const mounted = await mountTranscript(doc, images, options.now ?? new Date(), options.signal)
    try {
      const heights = mounted.items.map((item) => Math.ceil(heightOf(item)))
      const segments = planSegments(heights, { target: PDF_SEGMENT_TARGET, max: MAX_RENDER_HEIGHT })
      const composer = createPageComposer(SHARE_WIDTH * SCALE, heights.reduce((sum, height) => sum + height, 0) * SCALE, onProgress)
      for (const segment of segments) {
        throwIfAborted(options.signal)
        composer.report()
        const canvas = await renderSegment(mounted, segment)
        try {
          await composer.push(canvas)
        } finally {
          releaseCanvas(canvas)
        }
      }
      throwIfAborted(options.signal)
      const pages = await composer.finish()
      return { blob: pdfBlob(buildImagePdf(pages)), pages: pages.length }
    } finally {
      mounted.host.remove()
    }
  })
}

/** The long image as a JPEG under STAR's upload limit, scaled down only if it has to be. */
export async function uploadableImage(png: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(png)
  try {
    let scale = 1
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas unavailable')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      try {
        const jpeg = await canvasBlob(canvas, 'image/jpeg', 0.85)
        if (jpeg.size <= UPLOAD_LIMIT_BYTES) return jpeg
      } finally {
        releaseCanvas(canvas)
      }
      scale *= 0.8
    }
  } finally {
    bitmap.close()
  }
  throw new Error('长图太大，无法上传')
}

/** Saves through the browser's download path, as the token-usage share image does. */
export { downloadBlob } from '@/lib/downloadBlob'
