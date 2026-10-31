/**
 * STAR Design workspace API (`/api/star/design/…`).
 *
 *   GET    design/library                          open-design catalog (templates, systems, skills, craft)
 *   GET    design/library/:kind/:id                SKILL.md / DESIGN.md / craft text of one entry
 *   GET    design/library/template/:id/example     the template's example.html
 *   GET    design/projects                         design projects under the STAR Design folder
 *   POST   design/projects                         create { title, kind, width, height, style?, templateId?, systemId?, skillId? }
 *   GET    design/projects/:id                     project + artboards (snapshots changed boards as versions)
 *   PATCH  design/projects/:id                     merge canvas state (positions, names, order, sessionId)
 *   GET    design/projects/:id/raw/<path>          one project file
 *   PUT    design/projects/:id/raw/<path>          write a board (the previous content becomes a version)
 *   DELETE design/projects/:id/raw/<path>          move a board to .star/trash
 *   POST   design/projects/:id/assets?name=        raw bytes → assets/<name>
 *   POST   design/projects/:id/boards              { url | file, name? } add an image / video board
 *   GET    design/projects/:id/versions?board=     versions of one board; POST …/versions/restore { board, id }
 *
 * A project is a plain folder: `design.json`, `artboards/` (one file per
 * board: html / svg / image / video), `assets/` and `.star/` (brief, versions,
 * trash). The design agent works in that folder as a normal chat session.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { ApiError } from '../../middleware/errorHandler.js'
import { starOutputsDir } from './starMediaStore.js'

type Rec = Record<string, unknown>

const BOARD_EXTENSIONS = new Set(['.html', '.htm', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov'])
const TEXT_BOARD_EXTENSIONS = new Set(['.html', '.htm', '.svg'])
const MAX_VERSIONS = 40
const MAX_WRITE_BYTES = 40 * 1024 * 1024

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

export type DesignBoard = {
  path: string
  name: string
  kind: 'html' | 'svg' | 'image' | 'video'
  x: number
  y: number
  width: number
  height: number
  hidden: boolean
  locked: boolean
  size: number
  updatedAt: number
  versions: number
}

export type DesignProject = {
  id: string
  dir: string
  title: string
  kind: string
  width: number
  height: number
  style: string
  templateId: string
  systemId: string
  skillId: string
  sessionId: string
  createdAt: number
  updatedAt: number
  canvas: { zoom: number; x: number; y: number } | null
  boards: DesignBoard[]
  assets: { path: string; name: string; kind: 'image' | 'video' | 'other'; size: number; updatedAt: number }[]
}

// ─── locations ─────────────────────────────────────────────

export function starDesignRoot(): string {
  if (process.env.STAR_DESIGN_ROOT) return process.env.STAR_DESIGN_ROOT
  const documents = path.join(os.homedir(), 'Documents')
  return path.join(fs.existsSync(documents) ? documents : os.homedir(), 'STAR Design')
}

let openDesignRootCache: string | null | undefined

/** The vendored open-design resources (`desktop/public/open-design`, shipped inside dist/). */
export function openDesignRoot(): string | null {
  if (openDesignRootCache !== undefined && (openDesignRootCache === null || fs.existsSync(openDesignRootCache))) {
    if (openDesignRootCache) return openDesignRootCache
  }
  const exeDir = path.dirname(process.execPath)
  const candidates = [
    process.env.STAR_OPEN_DESIGN_DIR,
    process.env.CLAUDE_H5_DIST_DIR ? path.join(process.env.CLAUDE_H5_DIST_DIR, 'open-design') : undefined,
    path.resolve(exeDir, '..', '..', 'dist', 'open-design'),
    path.resolve(exeDir, '..', '..', 'public', 'open-design'),
    path.resolve(process.cwd(), 'desktop', 'public', 'open-design'),
    path.resolve(process.cwd(), 'public', 'open-design'),
  ]
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(path.join(candidate, 'index.json'))) {
      openDesignRootCache = candidate
      return candidate
    }
  }
  openDesignRootCache = null
  return null
}

function safeId(value: string | undefined): string {
  const id = (value ?? '').trim()
  if (!id || id.length > 120 || id.startsWith('.') || /[\\/:*?"<>|]/.test(id) || id.includes('..')) {
    throw ApiError.badRequest('Invalid id')
  }
  return id
}

/** Resolve a project-relative path; never escapes the project folder. */
function within(dir: string, rel: string): string {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleaned || cleaned.split('/').some(part => part === '..')) throw ApiError.badRequest('Invalid path')
  const resolved = path.resolve(dir, cleaned)
  const root = path.resolve(dir)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw ApiError.badRequest('Invalid path')
  return resolved
}

function projectDir(id: string): string {
  const dir = path.join(starDesignRoot(), safeId(id))
  if (!fs.existsSync(path.join(dir, 'design.json'))) throw ApiError.notFound('Design project not found')
  return dir
}

function readJson(file: string): Rec {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Rec : {}
  } catch {
    return {}
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(temp, file)
}

function str(value: unknown, max = 400): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function num(value: unknown, fallback: number, min = 1, max = 20_000): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback
}

// ─── board metadata ────────────────────────────────────────

function boardKind(ext: string): DesignBoard['kind'] {
  if (ext === '.svg') return 'svg'
  if (ext === '.html' || ext === '.htm') return 'html'
  if (ext === '.mp4' || ext === '.webm' || ext === '.mov') return 'video'
  return 'image'
}

/** Pixel size from the header of a PNG / JPEG / GIF / WebP file. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  if (bytes.length > 30 && bytes[0] === 0x52 && bytes[8] === 0x57) {
    const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!)
    if (chunk === 'VP8X') return { width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)), height: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) }
    if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    if (chunk === 'VP8L') {
      const b = view.getUint32(21, true)
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
    }
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue }
      const marker = bytes[offset + 1]!
      const length = view.getUint16(offset + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) }
      }
      offset += 2 + length
    }
  }
  return null
}

function textBoardSize(source: string, ext: string): { width: number; height: number } | null {
  const head = source.slice(0, 20_000)
  if (ext === '.svg') {
    const tag = /<svg\b[^>]*>/i.exec(head)?.[0] ?? ''
    const width = Number(/\bwidth="([\d.]+)(px)?"/i.exec(tag)?.[1])
    const height = Number(/\bheight="([\d.]+)(px)?"/i.exec(tag)?.[1])
    if (width > 0 && height > 0) return { width, height }
    const box = /\bviewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/i.exec(tag)
    if (box) return { width: Number(box[1]), height: Number(box[2]) }
    return null
  }
  const attrW = Number(/data-artboard-width="(\d+)"/i.exec(head)?.[1])
  const attrH = Number(/data-artboard-height="(\d+)"/i.exec(head)?.[1])
  if (attrW > 0 && attrH > 0) return { width: attrW, height: attrH }
  const meta = /<meta[^>]+name="artboard"[^>]+content="(\d+)\s*[x×*]\s*(\d+)"/i.exec(head)
  if (meta) return { width: Number(meta[1]), height: Number(meta[2]) }
  const body = /(?:html|body)\s*(?:,\s*(?:html|body)\s*)?\{[^}]*?\bwidth:\s*(\d+)px[^}]*?\bheight:\s*(\d+)px/i.exec(head)
  if (body) return { width: Number(body[1]), height: Number(body[2]) }
  return null
}

function boardDisplayName(rel: string): string {
  return path.basename(rel).replace(/\.[^.]+$/, '').replace(/^\d{1,3}[-_.\s]+/, '') || path.basename(rel)
}

function versionsDir(dir: string, rel: string): string {
  return path.join(dir, '.star', 'versions', rel.replace(/[\\/]/g, '__'))
}

function listVersionFiles(dir: string, rel: string): string[] {
  const vdir = versionsDir(dir, rel)
  try {
    return fs.readdirSync(vdir).filter(name => /^\d+\./.test(name)).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
  } catch {
    return []
  }
}

/** Keep the current content of a text board as a version (once per mtime). */
function snapshotBoard(dir: string, rel: string): void {
  const file = within(dir, rel)
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    return
  }
  const ext = path.extname(rel).toLowerCase()
  if (!TEXT_BOARD_EXTENSIONS.has(ext) || stat.size > MAX_WRITE_BYTES) return
  const stamp = String(Math.floor(stat.mtimeMs))
  const existing = listVersionFiles(dir, rel)
  if (existing.some(name => name.startsWith(`${stamp}.`))) return
  const vdir = versionsDir(dir, rel)
  fs.mkdirSync(vdir, { recursive: true })
  fs.copyFileSync(file, path.join(vdir, `${stamp}${ext}`))
  const all = [...existing, `${stamp}${ext}`]
  for (const old of all.slice(0, Math.max(0, all.length - MAX_VERSIONS))) {
    fs.rmSync(path.join(vdir, old), { force: true })
  }
}

function scanBoards(dir: string, meta: Rec): DesignBoard[] {
  const boardsDir = path.join(dir, 'artboards')
  let names: string[] = []
  try {
    names = fs.readdirSync(boardsDir).filter(name => BOARD_EXTENSIONS.has(path.extname(name).toLowerCase()))
  } catch { /* no boards yet */ }
  const layout = meta.boards && typeof meta.boards === 'object' ? meta.boards as Record<string, Rec> : {}
  const order = Array.isArray(meta.order) ? (meta.order as unknown[]).filter((item): item is string => typeof item === 'string') : []
  const defaultW = num(meta.width, 1080)
  const defaultH = num(meta.height, 1920)
  const rels = names.map(name => `artboards/${name}`)
  rels.sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib)
    return a.localeCompare(b, 'zh-CN', { numeric: true })
  })
  const boards: DesignBoard[] = []
  let nextX = 0
  for (const rel of rels) {
    const file = path.join(dir, rel)
    let stat: fs.Stats
    try {
      stat = fs.statSync(file)
    } catch {
      continue
    }
    const ext = path.extname(rel).toLowerCase()
    const kind = boardKind(ext)
    const saved = layout[rel] ?? {}
    let size: { width: number; height: number } | null = null
    if (TEXT_BOARD_EXTENSIONS.has(ext)) {
      snapshotBoard(dir, rel)
      try {
        const fd = fs.openSync(file, 'r')
        const buffer = Buffer.alloc(Math.min(stat.size, 20_000))
        fs.readSync(fd, buffer, 0, buffer.length, 0)
        fs.closeSync(fd)
        size = textBoardSize(buffer.toString('utf8'), ext)
      } catch { /* unreadable: defaults */ }
    } else if (kind === 'image') {
      try {
        const fd = fs.openSync(file, 'r')
        const buffer = Buffer.alloc(Math.min(stat.size, 256 * 1024))
        fs.readSync(fd, buffer, 0, buffer.length, 0)
        fs.closeSync(fd)
        size = imageSize(new Uint8Array(buffer))
      } catch { /* unreadable: defaults */ }
    }
    const width = num(saved.width, size?.width ?? defaultW)
    const height = num(saved.height, size?.height ?? defaultH, 1, 60_000)
    const hasPosition = typeof saved.x === 'number' && typeof saved.y === 'number'
    const x = hasPosition ? saved.x as number : nextX
    const y = hasPosition ? saved.y as number : 0
    nextX = Math.max(nextX, x + width + 120)
    boards.push({
      path: rel,
      name: str(saved.name, 80) || boardDisplayName(rel),
      kind,
      x,
      y,
      width,
      height,
      hidden: saved.hidden === true,
      locked: saved.locked === true,
      size: stat.size,
      updatedAt: Math.floor(stat.mtimeMs),
      versions: TEXT_BOARD_EXTENSIONS.has(ext) ? listVersionFiles(dir, rel).length : 0,
    })
  }
  return boards
}

function listAssets(dir: string): DesignProject['assets'] {
  const result: DesignProject['assets'] = []
  for (const sub of ['assets', 'assets/exports']) {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(path.join(dir, sub), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue
      const ext = path.extname(entry.name).toLowerCase()
      const stat = fs.statSync(path.join(dir, sub, entry.name))
      const kind = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext) ? 'image' : ['.mp4', '.webm', '.mov'].includes(ext) ? 'video' : 'other'
      result.push({ path: `${sub}/${entry.name}`, name: entry.name, kind, size: stat.size, updatedAt: Math.floor(stat.mtimeMs) })
    }
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 300)
}

function readProject(id: string): DesignProject {
  const dir = projectDir(id)
  const meta = readJson(path.join(dir, 'design.json'))
  const boards = scanBoards(dir, meta)
  const canvas = meta.canvas && typeof meta.canvas === 'object' ? meta.canvas as Rec : null
  return {
    id,
    dir,
    title: str(meta.title, 120) || id,
    kind: str(meta.kind, 40) || 'custom',
    width: num(meta.width, 1080),
    height: num(meta.height, 1920, 1, 60_000),
    style: str(meta.style, 80),
    templateId: str(meta.templateId, 120),
    systemId: str(meta.systemId, 120),
    skillId: str(meta.skillId, 120),
    sessionId: str(meta.sessionId, 80),
    createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : 0,
    updatedAt: Math.max(typeof meta.updatedAt === 'number' ? meta.updatedAt : 0, ...boards.map(board => board.updatedAt)),
    canvas: canvas ? { zoom: num(canvas.zoom, 100, 5, 800) / 100, x: Number(canvas.x) || 0, y: Number(canvas.y) || 0 } : null,
    boards,
    assets: listAssets(dir),
  }
}

// ─── open-design library ───────────────────────────────────

const LIBRARY_FILES: Record<string, (id: string) => string> = {
  template: id => path.join('templates', id, 'SKILL.md'),
  system: id => path.join('systems', id, 'DESIGN.md'),
  skill: id => path.join('skills', id, 'SKILL.md'),
  craft: id => path.join('craft', `${id}.md`),
}

function readLibraryText(kind: string, id: string): string | null {
  const root = openDesignRoot()
  const file = LIBRARY_FILES[kind]
  if (!root || !file) return null
  try {
    return fs.readFileSync(path.join(root, file(safeId(id))), 'utf8')
  } catch {
    return null
  }
}

function readLibraryIndex(): Rec {
  const root = openDesignRoot()
  if (!root) return { available: false, templates: [], systems: [], skills: [], craft: [] }
  return { available: true, ...readJson(path.join(root, 'index.json')) }
}

const KIND_LABELS: Record<string, string> = {
  poster: '海报',
  'long-poster': '长图海报',
  set: '套图',
  ppt: 'PPT',
  social: '社媒图文',
  brochure: '宣传册',
  banner: '易拉宝',
  vector: '矢量图',
  logo: 'Logo',
  web: '网页',
  invitation: '邀请函',
  card: '知识卡片',
  custom: '自定义',
}

function composeBrief(project: { title: string; kind: string; width: number; height: number; style: string }, refs: string[]): string {
  const kind = KIND_LABELS[project.kind] ?? project.kind
  const lines = [
    '# STAR Design 设计任务说明',
    '',
    `项目：${project.title}（${kind}，默认画板 ${project.width}×${project.height}${project.style ? `，风格：${project.style}` : ''}）`,
    '',
    '## 产出约定（右侧画板会实时显示 artboards/ 里的文件）',
    '- 每个画板是 artboards/ 下的一个独立文件，文件名用两位序号开头：`01-封面.html`、`02-内页.html`…',
    `- HTML 画板：根元素写 \`<html data-artboard-width="${project.width}" data-artboard-height="${project.height}">\`（尺寸按实际画板填写），body 固定为该像素尺寸、margin:0、overflow:hidden；样式写在 <style> 里，不引用外部 JS。字体可用 Google Fonts 或系统字体。`,
    '- 文字必须是真实的 HTML 文本（不要把文字画进图片），每个可编辑元素加 `data-layer="名称"`，用户会在画板里双击改字、拖动元素。',
    '- 矢量图（图标、Logo、插画）输出 `artboards/NN-名称.svg`，带 width/height 与 viewBox，形状分组并加 id。',
    '- 位图放在 assets/；在 HTML 里优先用生成工具返回的 https 地址引用，本地文件用相对路径 `../assets/xxx.png`。',
    '- 生图用 STAR 媒体工具：`star_text_to_image`（文生图）、`star_image_to_image`（图生图 / 改图 / 去文字背景）、`star_image_to_video`（图生视频），完成后用 `star_media_task` 查看结果。',
    '- 套图：每张一个画板，统一配色与版式，按顺序编号。长图海报：一个画板，高度按内容（如 1080×5000）。PPT：每页一个 1920×1080 画板。',
    '- 修改已有画板时直接覆盖原文件，系统会自动保存历史版本；新增方案用新文件名。',
    '- 用户要求“拆分图层”时：用 star_vision 分析原图，再用 star_image_to_image 生成去掉文字的背景图，最后用 HTML 把文字、标识等还原为独立图层。',
    '- 每轮结束用一两句话说明新增或改动了哪些画板。',
  ]
  if (refs.length) {
    lines.push('', '## 参考资料（按需用 Read 工具阅读）', ...refs.map(ref => `- ${ref}`))
  }
  return `${lines.join('\n')}\n`
}

function projectFolderName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\r\n\t]+/g, '-').replace(/^[.\s-]+|[.\s-]+$/g, '').slice(0, 40) || 'design'
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${base}-${stamp}`
}

function createProject(body: Rec): DesignProject {
  const title = str(body.title, 80) || '未命名设计'
  const kind = str(body.kind, 40) || 'poster'
  const width = num(body.width, 1080)
  const height = num(body.height, 1920, 1, 60_000)
  const style = str(body.style, 80)
  const templateId = str(body.templateId, 120)
  const systemId = str(body.systemId, 120)
  const skillId = str(body.skillId, 120)
  const root = starDesignRoot()
  let id = projectFolderName(title)
  while (fs.existsSync(path.join(root, id))) id = `${id}-1`
  const dir = path.join(root, id)
  fs.mkdirSync(path.join(dir, 'artboards'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.star'), { recursive: true })

  const refs: string[] = []
  const odRoot = openDesignRoot()
  const copyRef = (text: string | null, target: string, label: string) => {
    if (!text) return
    fs.writeFileSync(path.join(dir, '.star', target), text, 'utf8')
    refs.push(`.star/${target} — ${label}`)
  }
  if (templateId) {
    copyRef(readLibraryText('template', templateId), 'template.md', `模板写作说明（open-design：${templateId}）`)
    if (odRoot) {
      const example = path.join(odRoot, 'templates', safeId(templateId), 'example.html')
      if (fs.existsSync(example)) {
        fs.copyFileSync(example, path.join(dir, '.star', 'reference.html'))
        refs.push('.star/reference.html — 模板样例，可参考版式与配色（不要直接放进 artboards）')
      }
    }
  }
  if (systemId) copyRef(readLibraryText('system', systemId), 'design-system.md', `设计系统（open-design：${systemId}），配色、字体、组件规范`)
  if (skillId) copyRef(readLibraryText('skill', skillId), 'skill.md', `设计技能（open-design：${skillId}）`)
  if (odRoot && fs.existsSync(path.join(odRoot, 'craft'))) {
    const craftDir = path.join(dir, '.star', 'craft')
    fs.mkdirSync(craftDir, { recursive: true })
    for (const name of fs.readdirSync(path.join(odRoot, 'craft')).filter(file => file.endsWith('.md'))) {
      fs.copyFileSync(path.join(odRoot, 'craft', name), path.join(craftDir, name))
    }
    refs.push('.star/craft/*.md — 排版、配色、可访问性等通用设计规则')
  }
  fs.writeFileSync(path.join(dir, '.star', 'brief.md'), composeBrief({ title, kind, width, height, style }, refs), 'utf8')
  const now = Date.now()
  writeJson(path.join(dir, 'design.json'), {
    version: 1,
    title,
    kind,
    width,
    height,
    style,
    templateId,
    systemId,
    skillId,
    sessionId: '',
    createdAt: now,
    updatedAt: now,
    boards: {},
    order: [],
  })
  return readProject(id)
}

function listProjects(): Array<Omit<DesignProject, 'boards' | 'canvas' | 'assets'> & { boardCount: number; cover: string | null; coverKind: DesignBoard['kind'] | null }> {
  const root = starDesignRoot()
  let names: string[] = []
  try {
    names = fs.readdirSync(root).filter(name => !name.startsWith('.') && fs.existsSync(path.join(root, name, 'design.json')))
  } catch {
    return []
  }
  const projects = names.flatMap(name => {
    try {
      const project = readProject(name)
      const cover = project.boards.find(board => !board.hidden) ?? null
      const { boards, canvas: _canvas, assets: _assets, ...rest } = project
      return [{ ...rest, boardCount: boards.length, cover: cover?.path ?? null, coverKind: cover?.kind ?? null }]
    } catch {
      return []
    }
  })
  return projects.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200)
}

function patchProject(id: string, body: Rec): DesignProject {
  const dir = projectDir(id)
  const file = path.join(dir, 'design.json')
  const meta = readJson(file)
  if (typeof body.title === 'string' && body.title.trim()) meta.title = str(body.title, 80)
  if (typeof body.sessionId === 'string') meta.sessionId = str(body.sessionId, 80)
  if (typeof body.style === 'string') meta.style = str(body.style, 80)
  if (body.width !== undefined) meta.width = num(body.width, num(meta.width, 1080))
  if (body.height !== undefined) meta.height = num(body.height, num(meta.height, 1920), 1, 60_000)
  if (body.canvas && typeof body.canvas === 'object') {
    const canvas = body.canvas as Rec
    meta.canvas = { zoom: Math.round((Number(canvas.zoom) || 1) * 100), x: Math.round(Number(canvas.x) || 0), y: Math.round(Number(canvas.y) || 0) }
  }
  if (Array.isArray(body.order)) meta.order = (body.order as unknown[]).filter((item): item is string => typeof item === 'string').slice(0, 500)
  if (body.boards && typeof body.boards === 'object') {
    const boards = meta.boards && typeof meta.boards === 'object' ? meta.boards as Record<string, Rec> : {}
    for (const [rel, value] of Object.entries(body.boards as Record<string, unknown>)) {
      if (!rel.startsWith('artboards/') || !value || typeof value !== 'object') continue
      const patch = value as Rec
      const current = boards[rel] ?? {}
      boards[rel] = {
        ...current,
        ...(typeof patch.x === 'number' ? { x: Math.round(patch.x) } : {}),
        ...(typeof patch.y === 'number' ? { y: Math.round(patch.y) } : {}),
        ...(typeof patch.width === 'number' ? { width: num(patch.width, 1080) } : {}),
        ...(typeof patch.height === 'number' ? { height: num(patch.height, 1920, 1, 60_000) } : {}),
        ...(typeof patch.name === 'string' ? { name: str(patch.name, 80) } : {}),
        ...(typeof patch.hidden === 'boolean' ? { hidden: patch.hidden } : {}),
        ...(typeof patch.locked === 'boolean' ? { locked: patch.locked } : {}),
      }
    }
    meta.boards = boards
  }
  meta.updatedAt = Date.now()
  writeJson(file, meta)
  return readProject(id)
}

function uniqueFile(dir: string, name: string): string {
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  let candidate = name
  let index = 1
  while (fs.existsSync(path.join(dir, candidate))) candidate = `${base}-${index++}${ext}`
  return candidate
}

function safeFileName(name: string, fallback: string): string {
  const cleaned = path.basename(name).replace(/[\\/:*?"<>|\r\n\t]+/g, '-').trim().slice(0, 80)
  return cleaned && !cleaned.startsWith('.') ? cleaned : fallback
}

function nextBoardNumber(dir: string): string {
  let max = 0
  try {
    for (const name of fs.readdirSync(path.join(dir, 'artboards'))) {
      const match = /^(\d{1,3})[-_.\s]/.exec(name)
      if (match) max = Math.max(max, Number(match[1]))
    }
  } catch { /* empty */ }
  return String(max + 1).padStart(2, '0')
}

async function addMediaBoard(id: string, body: Rec): Promise<DesignProject> {
  const dir = projectDir(id)
  const label = safeFileName(str(body.name, 60) || 'image', 'image')
  let bytes: Uint8Array
  let ext = ''
  const file = str(body.file, 2000)
  const url = str(body.url, 4000)
  const source = str(body.source, 400)
  if (source) {
    // A project file (assets/… or artboards/…) copied into a new board.
    if (!source.startsWith('assets/') && !source.startsWith('artboards/')) throw ApiError.badRequest('Invalid source')
    const resolved = within(dir, source)
    if (!fs.existsSync(resolved)) throw ApiError.notFound('File not found')
    bytes = new Uint8Array(fs.readFileSync(resolved))
    ext = path.extname(resolved).toLowerCase()
    if (TEXT_BOARD_EXTENSIONS.has(ext)) {
      const boardsDir = path.join(dir, 'artboards')
      const name = uniqueFile(boardsDir, `${nextBoardNumber(dir)}-${label.replace(/\.[^.]+$/, '')}${ext}`)
      fs.writeFileSync(path.join(boardsDir, name), bytes)
      const rel = `artboards/${name}`
      return patchProject(id, { boards: { [rel]: { x: Number(body.x) || 0, y: Number(body.y) || 0 } } })
    }
  } else if (file) {
    const resolved = path.resolve(file)
    const outputs = path.resolve(starOutputsDir())
    if (!resolved.startsWith(outputs + path.sep) || !fs.existsSync(resolved)) throw ApiError.badRequest('File is not a STAR output')
    bytes = new Uint8Array(fs.readFileSync(resolved))
    ext = path.extname(resolved).toLowerCase()
  } else if (/^https:\/\//i.test(url)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw ApiError.badRequest(`下载失败（HTTP ${response.status}）`)
    bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > 200 * 1024 * 1024) throw ApiError.badRequest('File too large')
    ext = path.extname(new URL(url).pathname).toLowerCase()
    const type = response.headers.get('content-type') ?? ''
    if (!BOARD_EXTENSIONS.has(ext)) ext = type.includes('video') ? '.mp4' : type.includes('webp') ? '.webp' : type.includes('jpeg') ? '.jpg' : '.png'
  } else {
    throw ApiError.badRequest('Missing url or file')
  }
  if (!BOARD_EXTENSIONS.has(ext) || TEXT_BOARD_EXTENSIONS.has(ext)) ext = '.png'
  const boardsDir = path.join(dir, 'artboards')
  fs.mkdirSync(boardsDir, { recursive: true })
  const name = uniqueFile(boardsDir, `${nextBoardNumber(dir)}-${label.replace(/\.[^.]+$/, '')}${ext}`)
  fs.writeFileSync(path.join(boardsDir, name), bytes)
  const rel = `artboards/${name}`
  const position = body.x !== undefined || body.y !== undefined
    ? { [rel]: { x: Number(body.x) || 0, y: Number(body.y) || 0 } }
    : null
  return position ? patchProject(id, { boards: position }) : readProject(id)
}

// ─── HTTP ──────────────────────────────────────────────────

async function readJsonBody(req: Request): Promise<Rec> {
  try {
    const body = await req.json() as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Rec : {}
  } catch {
    throw ApiError.badRequest('Expected a JSON object')
  }
}

function rawPath(segments: string[], from: number): string {
  return segments.slice(from).map(part => decodeURIComponent(part)).join('/')
}

function fileResponse(file: string): Response {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw ApiError.notFound('File not found')
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  return new Response(Bun.file(file), { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } })
}

/**
 * A board shown in an iframe loads its ../assets/ files with the same local
 * token as the page itself (subresource requests carry no Authorization).
 */
function tokenizeAssets(html: string, token: string): string {
  const suffix = `?localToken=${encodeURIComponent(token)}`
  return html.replace(/((?:src|href|poster)\s*=\s*["']|url\(\s*["']?)((?:\.\.\/)?assets\/[^"')\s?#]+)/gi, (_match, head: string, target: string) => `${head}${target.startsWith('../') ? target : `../${target}`}${suffix}`)
}

async function handleRaw(req: Request, url: URL, id: string, rel: string): Promise<Response> {
  const dir = projectDir(id)
  const file = within(dir, rel)
  const token = url.searchParams.get('localToken')
  if (req.method === 'GET' && token && /\.html?$/i.test(rel) && fs.existsSync(file)) {
    return new Response(tokenizeAssets(fs.readFileSync(file, 'utf8'), token), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
  }
  if (req.method === 'GET') return fileResponse(file)
  if (!rel.startsWith('artboards/') && !rel.startsWith('assets/')) throw ApiError.badRequest('Only artboards/ and assets/ are writable')
  if (req.method === 'PUT') {
    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.byteLength > MAX_WRITE_BYTES) throw ApiError.badRequest('File too large')
    if (fs.existsSync(file)) snapshotBoard(dir, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, bytes)
    // The new content is a version too, so restoring never loses it.
    snapshotBoard(dir, rel)
    return Response.json({ project: readProject(id) })
  }
  if (req.method === 'DELETE') {
    if (!fs.existsSync(file)) throw ApiError.notFound('File not found')
    const trash = path.join(dir, '.star', 'trash')
    fs.mkdirSync(trash, { recursive: true })
    fs.renameSync(file, path.join(trash, `${Date.now()}-${path.basename(file)}`))
    return Response.json({ project: readProject(id) })
  }
  throw new ApiError(405, 'Method not allowed', 'METHOD_NOT_ALLOWED')
}

async function handleProject(req: Request, url: URL, segments: string[]): Promise<Response> {
  const id = segments[4] ? decodeURIComponent(segments[4]) : ''
  const action = segments[5]
  if (!id) {
    if (req.method === 'GET') return Response.json({ root: starDesignRoot(), projects: listProjects() })
    if (req.method === 'POST') return Response.json({ project: createProject(await readJsonBody(req)) }, { status: 201 })
    throw new ApiError(405, 'Method not allowed', 'METHOD_NOT_ALLOWED')
  }
  if (!action) {
    if (req.method === 'GET') return Response.json({ project: readProject(id) })
    if (req.method === 'PATCH') return Response.json({ project: patchProject(id, await readJsonBody(req)) })
    throw new ApiError(405, 'Method not allowed', 'METHOD_NOT_ALLOWED')
  }
  if (action === 'raw') return handleRaw(req, url, id, rawPath(segments, 6))
  if (action === 'assets' && req.method === 'POST') {
    const dir = projectDir(id)
    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.byteLength > MAX_WRITE_BYTES * 5) throw ApiError.badRequest('File too large')
    const assets = path.join(dir, 'assets')
    fs.mkdirSync(assets, { recursive: true })
    const name = uniqueFile(assets, safeFileName(url.searchParams.get('name') ?? '', 'upload.png'))
    fs.writeFileSync(path.join(assets, name), bytes)
    return Response.json({ path: `assets/${name}`, file: path.join(assets, name) })
  }
  if (action === 'boards' && req.method === 'POST') return Response.json({ project: await addMediaBoard(id, await readJsonBody(req)) })
  if (action === 'versions') {
    const dir = projectDir(id)
    if (segments[6] === 'restore' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const board = str(body.board, 400)
      const version = str(body.id, 40)
      const file = within(dir, board)
      const source = listVersionFiles(dir, board).find(name => name.startsWith(`${version}.`))
      if (!source) throw ApiError.notFound('Version not found')
      snapshotBoard(dir, board)
      fs.copyFileSync(path.join(versionsDir(dir, board), source), file)
      snapshotBoard(dir, board)
      return Response.json({ project: readProject(id) })
    }
    if (segments[6] === 'file' && req.method === 'GET') {
      const board = url.searchParams.get('board') ?? ''
      const version = url.searchParams.get('id') ?? ''
      within(dir, board)
      const source = listVersionFiles(dir, board).find(name => name.startsWith(`${version}.`))
      if (!source) throw ApiError.notFound('Version not found')
      return fileResponse(path.join(versionsDir(dir, board), source))
    }
    if (!segments[6] && req.method === 'GET') {
      const board = url.searchParams.get('board') ?? ''
      within(dir, board)
      const vdir = versionsDir(dir, board)
      const versions = listVersionFiles(dir, board).map(name => {
        const stat = fs.statSync(path.join(vdir, name))
        return { id: String(Number.parseInt(name, 10)), at: Number.parseInt(name, 10), size: stat.size }
      })
      return Response.json({ versions })
    }
  }
  throw ApiError.notFound('Unknown design endpoint')
}

async function handleLibrary(req: Request, segments: string[]): Promise<Response> {
  if (req.method !== 'GET') throw new ApiError(405, 'Method not allowed', 'METHOD_NOT_ALLOWED')
  const kind = segments[4]
  const id = segments[5] ? decodeURIComponent(segments[5]) : ''
  if (!kind) return Response.json(readLibraryIndex())
  if (kind === 'prompts') {
    const root = openDesignRoot()
    const name = id === 'video' ? 'video.json' : 'image.json'
    if (!root) return Response.json({ items: [] })
    const parsed = readJson(path.join(root, 'prompts', name))
    return Response.json(Object.keys(parsed).length ? parsed : { items: [] })
  }
  if (kind === 'template' && segments[6] === 'example') {
    const root = openDesignRoot()
    if (!root) throw ApiError.notFound('open-design resources are not installed')
    return fileResponse(path.join(root, 'templates', safeId(id), 'example.html'))
  }
  const text = readLibraryText(kind, id)
  if (text === null) throw ApiError.notFound('Library entry not found')
  return Response.json({ kind, id, text })
}

/** Blank project folders (项目 / 3D Make): Documents/STAR Projects/<name>. */
export function createLocalProject(name: string): { name: string; path: string } {
  const label = name.replace(/[\\/:*?"<>|\r\n\t]+/g, '-').replace(/^[.\s-]+|[.\s-]+$/g, '').slice(0, 60) || '新项目'
  const documents = path.join(os.homedir(), 'Documents')
  const root = process.env.STAR_PROJECTS_ROOT || path.join(fs.existsSync(documents) ? documents : os.homedir(), 'STAR Projects')
  let folder = label
  let index = 2
  while (fs.existsSync(path.join(root, folder))) folder = `${label}-${index++}`
  fs.mkdirSync(path.join(root, folder), { recursive: true })
  return { name: folder, path: path.join(root, folder) }
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?$|0\.)/i

/** Image bytes for canvas export: https only, public hosts, 25 MB. */
async function proxyImage(target: string): Promise<Response> {
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    throw ApiError.badRequest('Invalid url')
  }
  if (parsed.protocol !== 'https:' || PRIVATE_HOST.test(parsed.hostname)) throw ApiError.badRequest('Only public https images')
  const response = await fetch(parsed, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw ApiError.badRequest(`下载失败（HTTP ${response.status}）`)
  const type = response.headers.get('content-type') ?? 'application/octet-stream'
  if (!/^image\//i.test(type)) throw ApiError.badRequest('Not an image')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > 25 * 1024 * 1024) throw ApiError.badRequest('Image too large')
  return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=600' } })
}

export async function handleStarDesignApi(req: Request, url: URL, segments: string[]): Promise<Response> {
  switch (segments[3]) {
    case 'fetch':
      if (req.method !== 'GET') throw new ApiError(405, 'Method not allowed', 'METHOD_NOT_ALLOWED')
      return proxyImage(url.searchParams.get('url') ?? '')
    case 'library':
      return handleLibrary(req, segments)
    case 'projects':
      return handleProject(req, url, segments)
    default:
      throw ApiError.notFound('Unknown design endpoint')
  }
}
