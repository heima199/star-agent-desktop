/**
 * 「分享对话」 without the DOM: which messages a shared transcript keeps, the
 * Markdown export, file names, the transcript markup, and the arithmetic that
 * keeps every canvas inside the browser's limits (segments for html2canvas,
 * A4 pages for the PDF). conversationRender.ts does the drawing.
 */
import { getStarBrandName } from '@/stores/starBrandStore'
import type { UIAttachment, UIMessage } from '@/types/chat'

export type ShareContentOptions = {
  /** Each tool call as a one-line chip. */
  includeTools: boolean
  /** Thinking as a muted, collapsed block. */
  includeThinking: boolean
}

export const DEFAULT_SHARE_OPTIONS: ShareContentOptions = { includeTools: false, includeThinking: false }

export type ShareBlock =
  | { kind: 'user'; id: string; text: string; attachments: UIAttachment[]; from?: string }
  | { kind: 'assistant'; id: string; markdown: string }
  | { kind: 'thinking'; id: string; text: string }
  | { kind: 'tool'; id: string; toolName: string; arg: string }

/** A user turn and what STAR did in answer to it; only a transcript's first round can start without one. */
export type ShareRound = { blocks: ShareBlock[] }

/** Stands in for a conversation without a title: in the header and in file names. Named after the console's product name. */
export function fallbackTitle(): string {
  return `${getStarBrandName()} 对话`
}

// ─── Transcript ───────────────────────────────────────────────────

/** The input keys that say what a tool call was about, most telling first. */
const TOOL_ARG_KEYS = ['file_path', 'command', 'query', 'url', 'pattern', 'path', 'notebook_path', 'description'] as const
export const TOOL_ARG_MAX_CHARS = 60

function truncateChars(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join('')}…` : text
}

/** The first line of the argument that names what a tool call worked on, at most `max` characters. */
export function toolShortArg(input: unknown, max = TOOL_ARG_MAX_CHARS): string {
  if (!input || typeof input !== 'object') return ''
  const record = input as Record<string, unknown>
  for (const key of TOOL_ARG_KEYS) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const lines = value.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
    const first = lines[0]
    if (first === undefined) continue
    return truncateChars(lines.length > 1 ? `${first} …` : first, max)
  }
  return ''
}

/** 「工具 · Bash · npm test」 */
export function toolChipText(block: { toolName: string; arg: string }): string {
  return block.arg ? `工具 · ${block.toolName} · ${block.arg}` : `工具 · ${block.toolName}`
}

/**
 * Groups a transcript into rounds of what a reader of the conversation saw.
 * A subagent's own calls (`parentToolUseId`) belong to the call that started it
 * and stay out; so do tool results, system rows and errors.
 */
export function buildShareTranscript(messages: readonly UIMessage[], options: ShareContentOptions): ShareRound[] {
  const rounds: ShareRound[] = []
  const add = (block: ShareBlock) => {
    const last = rounds[rounds.length - 1]
    if (block.kind === 'user' || !last) rounds.push({ blocks: [block] })
    else last.blocks.push(block)
  }
  for (const message of messages) {
    if ('parentToolUseId' in message && message.parentToolUseId) continue
    switch (message.type) {
      case 'user_text': {
        const text = message.content.trim()
        const attachments = message.attachments ?? []
        if (!text && !attachments.length) break
        add({ kind: 'user', id: message.id, text, attachments, ...(message.teammateFrom ? { from: message.teammateFrom } : {}) })
        break
      }
      case 'assistant_text': {
        const markdown = message.content.trim()
        if (markdown) add({ kind: 'assistant', id: message.id, markdown })
        break
      }
      case 'thinking': {
        const text = message.content.trim()
        if (options.includeThinking && text) add({ kind: 'thinking', id: message.id, text })
        break
      }
      case 'tool_use':
        if (options.includeTools) add({ kind: 'tool', id: message.id, toolName: message.toolName, arg: toolShortArg(message.input) })
        break
      default:
        break
    }
  }
  return rounds
}

/** When the conversation started: the first row with a usable timestamp. */
export function conversationStartedAt(messages: readonly UIMessage[]): Date | null {
  for (const message of messages) {
    if (Number.isFinite(message.timestamp) && message.timestamp > 0) return new Date(message.timestamp)
  }
  return null
}

const THINKING_PREVIEW_LINES = 3
const THINKING_PREVIEW_CHARS = 160

/** What a collapsed thinking block shows: its first lines, cut short. */
export function collapseThinking(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const head = lines.slice(0, THINKING_PREVIEW_LINES).join('\n')
  const clipped = truncateChars(head, THINKING_PREVIEW_CHARS)
  return clipped === head && lines.length > THINKING_PREVIEW_LINES ? `${head}…` : clipped
}

// ─── Names and times ──────────────────────────────────────────────

const pad2 = (value: number) => String(value).padStart(2, '0')

/** yyyy-MM-dd HH:mm, local time. */
export function formatShareTime(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** yyyyMMdd-HHmm, local time. */
export function formatFileStamp(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`
}

/** The conversation title on one line, or the fallback. */
export function shareTitle(title: string | null | undefined): string {
  const line = (title ?? '').replace(/\s+/g, ' ').trim()
  return line || fallbackTitle()
}

/** Characters Windows does not allow in a file name. */
const FILE_NAME_RESERVED = /[\\/:*?"<>|]/g
const FILE_STEM_MAX_CHARS = 80

/** `<title>-<yyyyMMdd-HHmm>.<ext>`, safe to save on every platform. */
export function exportFileName(title: string, date: Date, extension: string): string {
  const visible = Array.from(shareTitle(title).replace(FILE_NAME_RESERVED, '_')).filter((char) => {
    const code = char.codePointAt(0) ?? 0
    return code >= 0x20 && code !== 0x7f
  })
  // Windows drops trailing dots and spaces, which would leave `name-.png` looking odd.
  const stem = visible.slice(0, FILE_STEM_MAX_CHARS).join('').replace(/[. ]+$/, '').trim() || fallbackTitle()
  return `${stem}-${formatFileStamp(date)}.${extension}`
}

// ─── Markdown export ──────────────────────────────────────────────

/** Closes a code fence the text leaves open, so it cannot swallow the sections after it. */
export function closeOpenFence(markdown: string): string {
  let open: { char: string; length: number } | null = null
  for (const line of markdown.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (!match) continue
    const fence = match[1] ?? ''
    const rest = match[2] ?? ''
    const char = fence.charAt(0)
    if (!open) {
      // A backtick fence's info string cannot hold a backtick; such a line is not a fence.
      if (char === '`' && rest.includes('`')) continue
      open = { char, length: fence.length }
    } else if (char === open.char && fence.length >= open.length && !rest.trim()) {
      open = null
    }
  }
  return open ? `${markdown.replace(/\s+$/, '')}\n${open.char.repeat(open.length)}` : markdown
}

/** Inline code that survives backticks inside it. */
function inlineCode(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

function quoteMarkdown(text: string): string {
  return closeOpenFence(text).split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n')
}

/** Forward slashes keep `\.` in a Windows path from being read as an escaped dot. */
function markdownDestination(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  return /[\s()<>]/.test(slashed) ? `<${slashed.replace(/[<>]/g, (char) => encodeURIComponent(char))}>` : slashed
}

function markdownAttachment(attachment: UIAttachment): string {
  const name = attachment.name || '附件'
  if (attachment.type === 'image' && attachment.path) {
    return `![${name.replace(/[[\]\\]/g, '\\$&')}](${markdownDestination(attachment.path)})`
  }
  return `[附件] ${name}`
}

/**
 * The conversation as Markdown: `# title`, then a `## 用户` / `## STAR` section
 * per turn holding the original Markdown, code fences intact.
 */
export function buildConversationMarkdown(input: { title: string; rounds: readonly ShareRound[]; generatedAt: Date }): string {
  const brand = getStarBrandName()
  const parts = [`# ${shareTitle(input.title)}`, `> 由 ${brand} 生成 · ${formatShareTime(input.generatedAt)}`]
  for (const round of input.rounds) {
    let replying = false
    for (const block of round.blocks) {
      if (block.kind === 'user') {
        parts.push(block.from ? `## 用户（来自 ${block.from}）` : '## 用户')
        if (block.text) parts.push(closeOpenFence(block.text))
        parts.push(...block.attachments.map(markdownAttachment))
        replying = false
        continue
      }
      if (!replying) {
        parts.push(`## ${brand}`)
        replying = true
      }
      if (block.kind === 'assistant') parts.push(closeOpenFence(block.markdown))
      else if (block.kind === 'tool') parts.push(`> 工具 · ${inlineCode(block.toolName)}${block.arg ? ` · ${inlineCode(block.arg)}` : ''}`)
      else parts.push(quoteMarkdown(`思考过程\n\n${block.text}`))
    }
  }
  return `${parts.join('\n\n')}\n`
}

// ─── Transcript markup ────────────────────────────────────────────

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)
}

/** Where a picture goes once it is loaded (see `fillImageSlots` in conversationRender.ts). */
export function imageSlotHtml(index: number, name: string): string {
  return `<span data-share-src="${index}" data-share-name="${escapeHtml(name)}"></span>`
}

/** What stands in for a picture that cannot be shown. */
export function missingImageText(name: string): string {
  return name ? `[图片] ${name}` : '[图片]'
}

export function missingImageHtml(name: string): string {
  return `<span data-share-missing>${escapeHtml(missingImageText(name))}</span>`
}

const BODY_FONT = `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`
const MONO_FONT = `'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, monospace`

/**
 * The exported picture's own light palette (the app's white theme), the same in
 * every theme. Vertical spacing lives in each item's padding, never in margins
 * between items, so a run of items drawn on its own (one PDF segment) lays out
 * exactly as it does inside the whole transcript.
 */
export function transcriptCss(p: string): string {
  return `
.${p} { box-sizing: border-box; margin: 0; padding: 0 48px; background: #ffffff; color: #1f1e1c; font-family: ${BODY_FONT}; font-size: 15px; font-weight: 400; line-height: 1.7; text-align: left; letter-spacing: 0; word-break: normal; overflow-wrap: anywhere; }
.${p} *, .${p} *::before, .${p} *::after { box-sizing: border-box; }
.${p} [hidden] { display: none !important; }
.${p}-header { padding: 44px 0 22px; border-bottom: 1px solid #e9e8e5; }
.${p}-brand { margin: 0 0 10px; font-size: 12px; font-weight: 600; line-height: 1.4; color: #6f6b65; }
.${p}-title { margin: 0; font-size: 22px; font-weight: 600; line-height: 1.45; color: #1f1e1c; }
.${p}-meta { margin: 8px 0 0; font-size: 13px; line-height: 1.5; color: #6f6b65; }
.${p}-user { display: flex; flex-direction: column; align-items: flex-end; padding: 22px 0 8px; }
.${p}-from { margin: 0 0 6px; font-size: 12px; line-height: 1.4; color: #6f6b65; }
.${p}-bubble { max-width: 86%; padding: 10px 16px; border-radius: 18px; background: #f1f0ee; color: #1f1e1c; white-space: pre-wrap; }
.${p}-files { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; max-width: 86%; margin: 8px 0 0; }
.${p}-file, .${p} [data-share-missing] { display: inline-block; padding: 1px 10px; border-radius: 8px; border: 1px solid #e9e8e5; background: #ffffff; font-size: 13px; line-height: 1.7; color: #55524d; }
.${p} [data-share-pic] { display: block; width: auto; height: auto; max-width: 100%; max-height: 360px; border-radius: 12px; border: 1px solid #e9e8e5; }
.${p}-reply { padding: 8px 0; }
.${p}-label { margin: 0 0 6px; font-size: 12px; font-weight: 600; line-height: 1.4; color: #6f6b65; }
.${p}-tool { padding: 3px 0; }
.${p}-chip { display: inline-block; max-width: 100%; padding: 1px 12px; border-radius: 999px; border: 1px solid #e9e8e5; background: #f5f5f3; font-size: 13px; line-height: 1.8; color: #55524d; }
.${p}-thinking { padding: 6px 0; }
.${p}-thought { padding: 2px 0 2px 12px; border-left: 2px solid #e9e8e5; font-size: 13px; line-height: 1.65; color: #6f6b65; }
.${p}-thought-title { margin: 0 0 2px; font-weight: 600; }
.${p}-thought-text { white-space: pre-wrap; }
.${p}-note { padding: 18px 0 0; font-size: 13px; line-height: 1.6; color: #6f6b65; text-align: center; }
.${p}-footer { padding: 28px 0 36px; }
.${p}-footer-line { padding: 16px 0 0; border-top: 1px solid #e9e8e5; font-size: 12px; line-height: 1.5; color: #6f6b65; text-align: center; }
.${p}-md > :first-child { margin-top: 0; }
.${p}-md > :last-child { margin-bottom: 0; }
.${p}-md p { margin: 0 0 12px; }
.${p}-md h1, .${p}-md h2, .${p}-md h3, .${p}-md h4, .${p}-md h5, .${p}-md h6 { margin: 20px 0 10px; font-weight: 600; line-height: 1.45; color: #1f1e1c; }
.${p}-md h1 { font-size: 22px; }
.${p}-md h2 { font-size: 18px; }
.${p}-md h3, .${p}-md h4, .${p}-md h5, .${p}-md h6 { font-size: 15px; }
.${p}-md ul, .${p}-md ol { margin: 0 0 12px; padding: 0 0 0 24px; }
.${p}-md ul { list-style: disc outside; }
.${p}-md ul ul { list-style-type: circle; }
.${p}-md ol { list-style: decimal outside; }
.${p}-md li { margin: 4px 0; }
.${p}-md li > p { margin: 0 0 6px; }
.${p}-md li > ul, .${p}-md li > ol { margin: 4px 0 0; }
.${p}-md blockquote { margin: 0 0 12px; padding: 2px 0 2px 14px; border-left: 3px solid #e9e8e5; color: #55524d; }
.${p}-md pre { margin: 0 0 12px; padding: 12px 14px; border-radius: 10px; border: 1px solid #e9e8e5; background: #f5f5f3; font-family: ${MONO_FONT}; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; overflow-wrap: anywhere; }
.${p}-md code { padding: 1px 5px; border-radius: 5px; background: #f1f0ee; color: #1f1e1c; font-family: ${MONO_FONT}; font-size: 13px; }
.${p}-md pre code { padding: 0; border-radius: 0; background: transparent; white-space: pre-wrap; }
.${p}-md table { width: 100%; margin: 0 0 12px; border-collapse: collapse; font-size: 14px; line-height: 1.6; }
.${p}-md th, .${p}-md td { padding: 6px 10px; border: 1px solid #e9e8e5; text-align: left; vertical-align: top; }
.${p}-md th { background: #f5f5f3; font-weight: 600; }
.${p}-md a { color: #2c66c9; text-decoration: none; }
.${p}-md hr { height: 0; margin: 16px 0; border: 0; border-top: 1px solid #e9e8e5; }
.${p}-md strong, .${p}-md b { font-weight: 600; }
.${p}-md em { font-style: normal; color: #55524d; }
.${p}-md del { color: #6f6b65; text-decoration: line-through; }
.${p}-md input[type="checkbox"] { margin: 0 6px 0 0; vertical-align: middle; }
.${p}-md [data-share-pic] { max-height: 480px; margin: 4px 0; }
`
}

export type TranscriptHtmlInput = {
  /** Class prefix, unique per mount so the scoped style cannot reach anything else. */
  prefix: string
  title: string
  /** Under the title: when the conversation started and how many rounds it has. */
  meta: string
  /** 「由 STAR 生成 · yyyy-MM-dd HH:mm」 */
  footer: string
  rounds: readonly ShareRound[]
  /** Sanitized HTML for one assistant reply. */
  renderMarkdown: (markdown: string) => string
  /** The image slot for an attachment's picture, or null when it cannot be shown. */
  attachmentSlot: (attachment: UIAttachment) => number | null
}

/**
 * The transcript markup. Every vertical piece is marked: `data-share-item` on
 * the header, each block and the footer (the units a PDF segment is made of),
 * `data-share-round` on each round (the unit the long image is cut by), and
 * `data-share-note` on the hidden line that says the long image was cut.
 */
export function buildTranscriptHtml(input: TranscriptHtmlInput): string {
  const p = input.prefix
  const brand = escapeHtml(getStarBrandName())
  const rounds = input.rounds.map((round, index) => {
    let labelled = false
    const blocks = round.blocks.map((block) => {
      if (block.kind === 'user') {
        labelled = false
        const files = block.attachments.map((attachment) => {
          if (attachment.type === 'image') {
            const slot = input.attachmentSlot(attachment)
            return slot === null ? missingImageHtml(attachment.name) : imageSlotHtml(slot, attachment.name)
          }
          return `<span class="${p}-file">${attachment.isDirectory ? '[文件夹]' : '[附件]'} ${escapeHtml(attachment.name)}</span>`
        }).join('')
        return `<div class="${p}-user" data-share-item>${
          block.from ? `<div class="${p}-from">来自 ${escapeHtml(block.from)}</div>` : ''
        }${
          block.text ? `<div class="${p}-bubble">${escapeHtml(block.text)}</div>` : ''
        }${
          files ? `<div class="${p}-files">${files}</div>` : ''
        }</div>`
      }
      // One product-name label per reply, however many blocks it takes.
      const label = labelled ? '' : `<div class="${p}-label">${brand}</div>`
      labelled = true
      if (block.kind === 'assistant') {
        return `<div class="${p}-reply" data-share-item>${label}<div class="${p}-md">${input.renderMarkdown(block.markdown)}</div></div>`
      }
      if (block.kind === 'tool') {
        return `<div class="${p}-tool" data-share-item>${label}<span class="${p}-chip">${escapeHtml(toolChipText(block))}</span></div>`
      }
      return `<div class="${p}-thinking" data-share-item>${label}<div class="${p}-thought"><div class="${p}-thought-title">思考过程</div><div class="${p}-thought-text">${escapeHtml(collapseThinking(block.text))}</div></div></div>`
    }).join('')
    return `<section class="${p}-round" data-share-round="${index}">${blocks}</section>`
  }).join('')

  return [
    `<style>${transcriptCss(p)}</style>`,
    `<header class="${p}-header" data-share-item><div class="${p}-brand">${brand}</div><h1 class="${p}-title">${escapeHtml(input.title)}</h1><div class="${p}-meta">${escapeHtml(input.meta)}</div></header>`,
    rounds,
    `<div class="${p}-note" data-share-note hidden></div>`,
    `<footer class="${p}-footer" data-share-item><div class="${p}-footer-line">${escapeHtml(input.footer)}</div></footer>`,
  ].join('')
}

// ─── Canvas arithmetic ────────────────────────────────────────────

export type RenderSegment =
  /** Whole items `[from, to)`. */
  | { kind: 'items'; from: number; to: number; height: number }
  /** Part of one item taller than a canvas may be. */
  | { kind: 'slice'; item: number; offset: number; height: number }

/**
 * Groups measured item heights (CSS px, top to bottom) into html2canvas calls.
 * A group holds whole items and stops growing once it reaches `target`; none
 * exceeds `max`, except that an item taller than `max` is cut into slices.
 */
export function planSegments(heights: readonly number[], limits: { target: number; max: number }): RenderSegment[] {
  const max = Math.max(1, limits.max)
  const segments: RenderSegment[] = []
  let index = 0
  while (index < heights.length) {
    const height = Math.max(0, heights[index] ?? 0)
    if (height > max) {
      for (let offset = 0; offset < height; offset += max) {
        segments.push({ kind: 'slice', item: index, offset, height: Math.min(max, height - offset) })
      }
      index += 1
      continue
    }
    const from = index
    let total = 0
    while (index < heights.length) {
      const next = Math.max(0, heights[index] ?? 0)
      if (next > max || total + next > max || (index > from && total >= limits.target)) break
      total += next
      index += 1
    }
    segments.push({ kind: 'items', from, to: index, height: total })
  }
  return segments
}

export type LongImagePlan = {
  /** Rounds drawn, counted from the first. */
  rounds: number
  /** Set when not even the first round fits: the height that round is clipped to. */
  clipFirstRound: number | null
  truncated: boolean
}

/**
 * How much of the transcript one picture can hold (CSS px). When it is too
 * tall the picture keeps the first rounds that fit, plus the note saying so.
 */
export function planLongImage(input: { header: number; rounds: readonly number[]; note: number; footer: number; max: number }): LongImagePlan {
  const total = input.rounds.reduce((sum, height) => sum + height, 0)
  if (!input.rounds.length || input.header + total + input.footer <= input.max) {
    return { rounds: input.rounds.length, clipFirstRound: null, truncated: false }
  }
  const budget = input.max - input.header - input.note - input.footer
  let used = 0
  let count = 0
  while (count < input.rounds.length && used + (input.rounds[count] ?? 0) <= budget) {
    used += input.rounds[count] ?? 0
    count += 1
  }
  if (count > 0) return { rounds: count, clipFirstRound: null, truncated: true }
  return { rounds: 1, clipFirstRound: Math.max(0, Math.floor(budget)), truncated: true }
}

/** An A4 (210 × 297 mm) page as tall as `width` asks. */
export function a4PageHeight(width: number): number {
  return Math.round((width * 297) / 210)
}

/** For the progress line: the pages done plus what the rows still to place need. */
export function estimatePageCount(done: number, remainingRows: number, rowsPerPage: number): number {
  return Math.max(done + 1, done + Math.ceil(Math.max(0, remainingRows) / Math.max(1, rowsPerPage)))
}

/** A pixel darker than this (0–255 luma) is ink: text, a picture, a rule in text color. */
export const INK_LUMA = 200

/**
 * The lowest of `rows` RGBA rows with no ink, or null when every row has some.
 * A page break through such a row cannot cut a line of text in half.
 */
export function findBlankRow(pixels: Uint8ClampedArray, width: number, rows: number, inkLuma = INK_LUMA): number | null {
  const threshold = inkLuma * 1000
  for (let row = rows - 1; row >= 0; row--) {
    const start = row * width * 4
    const end = start + width * 4
    let inked = false
    for (let at = start; at < end; at += 4) {
      if ((pixels[at] ?? 255) * 299 + (pixels[at + 1] ?? 255) * 587 + (pixels[at + 2] ?? 255) * 114 < threshold) {
        inked = true
        break
      }
    }
    if (!inked) return row
  }
  return null
}
