/**
 * Local knowledge bases (`/api/star/kb/…`). A knowledge base is a folder the
 * agent can work in: the uploaded originals under `files/`, their extracted
 * text under `text/` (what the agent greps and reads) and `kb.json`.
 *
 *   GET    kb                       list
 *   POST   kb                       { name, description? }
 *   GET    kb/:id                   one base with its documents
 *   PATCH  kb/:id                   { name?, description? }
 *   DELETE kb/:id                   moves the folder to .trash
 *   POST   kb/:id/docs?name=        raw bytes → original + extracted text
 *   DELETE kb/:id/docs/:docId
 *   GET    kb/:id/search?q=         keyword search over the extracted text
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { ApiError } from '../../middleware/errorHandler.js'
import { StarApiError } from './starClient.js'
import { starExtractBytes } from './starToolsService.js'

type Rec = Record<string, unknown>

export type KnowledgeDoc = {
  id: string
  name: string
  file: string
  textFile: string
  size: number
  chars: number
  via: string
  addedAt: number
  error?: string
}

export type KnowledgeBase = {
  id: string
  name: string
  description: string
  dir: string
  createdAt: number
  updatedAt: number
  docs: KnowledgeDoc[]
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.html', '.htm', '.xml', '.yaml', '.yml', '.log', '.ts', '.js', '.py'])
const MAX_UPLOAD = 80 * 1024 * 1024

export function starKnowledgeRoot(): string {
  if (process.env.STAR_KNOWLEDGE_ROOT) return process.env.STAR_KNOWLEDGE_ROOT
  const documents = path.join(os.homedir(), 'Documents')
  return path.join(fs.existsSync(documents) ? documents : os.homedir(), 'STAR Knowledge')
}

function safeId(value: string | undefined): string {
  const id = (value ?? '').trim()
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)) throw ApiError.badRequest('Invalid id')
  return id
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

function baseDir(id: string): string {
  const dir = path.join(starKnowledgeRoot(), safeId(id))
  if (!fs.existsSync(path.join(dir, 'kb.json'))) throw ApiError.notFound('Knowledge base not found')
  return dir
}

function readBase(id: string): KnowledgeBase {
  const dir = baseDir(id)
  let raw: Rec = {}
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'kb.json'), 'utf8')) as Rec
  } catch { /* corrupt: show as empty */ }
  const docs = Array.isArray(raw.docs) ? (raw.docs as Rec[]).filter(doc => doc && typeof doc.id === 'string') as unknown as KnowledgeDoc[] : []
  return {
    id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : id,
    description: typeof raw.description === 'string' ? raw.description : '',
    dir,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    docs,
  }
}

function writeBase(base: KnowledgeBase): void {
  const { dir, ...rest } = base
  const file = path.join(dir, 'kb.json')
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...rest, updatedAt: Date.now() }, null, 2), 'utf8')
  fs.renameSync(`${file}.tmp`, file)
}

function writeReadme(base: KnowledgeBase): void {
  const lines = [
    `# ${base.name}`,
    '',
    base.description || '',
    '',
    '这是一个 STAR 知识库。回答问题时先在 text/ 目录中检索（Grep / Read），引用时注明来源文件名。',
    '',
    '## 文档',
    ...base.docs.map(doc => `- ${doc.name} → ${doc.textFile}${doc.error ? `（未能解析：${doc.error}）` : ''}`),
  ]
  fs.writeFileSync(path.join(base.dir, 'README.md'), `${lines.join('\n')}\n`, 'utf8')
}

function listBases(): Array<Omit<KnowledgeBase, 'docs'> & { docCount: number; chars: number }> {
  const root = starKnowledgeRoot()
  let names: string[] = []
  try {
    names = fs.readdirSync(root).filter(name => !name.startsWith('.') && fs.existsSync(path.join(root, name, 'kb.json')))
  } catch {
    return []
  }
  return names.flatMap(name => {
    try {
      const { docs, ...base } = readBase(name)
      return [{ ...base, docCount: docs.length, chars: docs.reduce((sum, doc) => sum + (doc.chars || 0), 0) }]
    } catch {
      return []
    }
  }).sort((a, b) => b.updatedAt - a.updatedAt)
}

async function readJsonBody(req: Request): Promise<Rec> {
  try {
    const body = await req.json() as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Rec : {}
  } catch {
    throw ApiError.badRequest('Expected a JSON object')
  }
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function safeName(name: string): string {
  return path.basename(name).replace(/[\\/:*?"<>|\r\n\t]+/g, '-').trim().slice(0, 120) || 'document.txt'
}

function decode(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    return new TextDecoder('gb18030').decode(bytes)
  } catch {
    return utf8
  }
}

async function addDocument(id: string, name: string, bytes: Uint8Array): Promise<KnowledgeBase> {
  const base = readBase(id)
  const docId = newId('doc')
  const fileName = safeName(name)
  const ext = path.extname(fileName).toLowerCase()
  fs.mkdirSync(path.join(base.dir, 'files'), { recursive: true })
  fs.mkdirSync(path.join(base.dir, 'text'), { recursive: true })
  const stored = `files/${docId}-${fileName}`
  fs.writeFileSync(path.join(base.dir, stored), bytes)
  let content = ''
  let via = 'local'
  let error: string | undefined
  if (TEXT_EXTENSIONS.has(ext)) {
    content = decode(bytes)
  } else {
    try {
      const result = await starExtractBytes(bytes, fileName)
      content = result.text
      via = result.via
    } catch (failure) {
      error = failure instanceof StarApiError || failure instanceof Error ? failure.message : String(failure)
    }
  }
  const textFile = `text/${docId}-${fileName.replace(/\.[^.]+$/, '')}.md`
  fs.writeFileSync(path.join(base.dir, textFile), `# ${fileName}\n\n${content}`, 'utf8')
  base.docs.push({ id: docId, name: fileName, file: stored, textFile, size: bytes.byteLength, chars: content.length, via, addedAt: Date.now(), ...(error ? { error } : {}) })
  writeBase(base)
  writeReadme(base)
  return readBase(id)
}

function removeDocument(id: string, docId: string): KnowledgeBase {
  const base = readBase(id)
  const doc = base.docs.find(item => item.id === docId)
  if (!doc) throw ApiError.notFound('Document not found')
  const trash = path.join(base.dir, '.trash')
  fs.mkdirSync(trash, { recursive: true })
  for (const rel of [doc.file, doc.textFile]) {
    const file = path.join(base.dir, rel)
    if (fs.existsSync(file)) fs.renameSync(file, path.join(trash, `${Date.now()}-${path.basename(rel)}`))
  }
  base.docs = base.docs.filter(item => item.id !== docId)
  writeBase(base)
  writeReadme(base)
  return readBase(id)
}

/** Terms of a query: words, plus CJK bigrams so Chinese matches without a tokenizer. */
function queryTerms(query: string): string[] {
  const terms = new Set<string>()
  for (const word of query.toLowerCase().split(/[\s,，。;；、]+/).filter(Boolean)) {
    if (/[\u4e00-\u9fff]/.test(word) && word.length > 2) {
      for (let i = 0; i < word.length - 1; i++) terms.add(word.slice(i, i + 2))
    } else {
      terms.add(word)
    }
  }
  return [...terms].slice(0, 30)
}

function searchBase(id: string, query: string): Array<{ docId: string; name: string; snippet: string; score: number }> {
  const base = readBase(id)
  const terms = queryTerms(query)
  if (!terms.length) return []
  const hits: Array<{ docId: string; name: string; snippet: string; score: number }> = []
  for (const doc of base.docs) {
    let content = ''
    try {
      content = fs.readFileSync(path.join(base.dir, doc.textFile), 'utf8')
    } catch {
      continue
    }
    const paragraphs = content.split(/\n{2,}/)
    let chunk = ''
    const flush = () => {
      const lower = chunk.toLowerCase()
      const score = terms.reduce((sum, term) => sum + (lower.split(term).length - 1), 0)
      if (score > 0) hits.push({ docId: doc.id, name: doc.name, snippet: chunk.trim().slice(0, 600), score })
      chunk = ''
    }
    for (const paragraph of paragraphs) {
      chunk += `${paragraph}\n\n`
      if (chunk.length > 800) flush()
    }
    if (chunk.trim()) flush()
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 10)
}

export async function handleStarKnowledgeApi(req: Request, url: URL, segments: string[]): Promise<Response> {
  const id = segments[3]
  const action = segments[4]
  if (!id) {
    if (req.method === 'GET') return Response.json({ root: starKnowledgeRoot(), bases: listBases() })
    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      const name = text(body.name, 60)
      if (!name) throw ApiError.badRequest('请填写知识库名称')
      const kbId = newId('kb')
      const dir = path.join(starKnowledgeRoot(), kbId)
      fs.mkdirSync(path.join(dir, 'text'), { recursive: true })
      fs.mkdirSync(path.join(dir, 'files'), { recursive: true })
      const base: KnowledgeBase = { id: kbId, name, description: text(body.description, 500), dir, createdAt: Date.now(), updatedAt: Date.now(), docs: [] }
      writeBase(base)
      writeReadme(base)
      return Response.json({ base: readBase(kbId) }, { status: 201 })
    }
  } else if (!action) {
    if (req.method === 'GET') return Response.json({ base: readBase(id) })
    if (req.method === 'PATCH') {
      const body = await readJsonBody(req)
      const base = readBase(id)
      if (text(body.name, 60)) base.name = text(body.name, 60)
      if (typeof body.description === 'string') base.description = text(body.description, 500)
      writeBase(base)
      writeReadme(base)
      return Response.json({ base: readBase(id) })
    }
    if (req.method === 'DELETE') {
      const dir = baseDir(id)
      const trash = path.join(starKnowledgeRoot(), '.trash')
      fs.mkdirSync(trash, { recursive: true })
      fs.renameSync(dir, path.join(trash, `${Date.now()}-${path.basename(dir)}`))
      return Response.json({ ok: true })
    }
  } else if (action === 'docs') {
    if (req.method === 'POST' && !segments[5]) {
      const bytes = new Uint8Array(await req.arrayBuffer())
      if (!bytes.byteLength) throw ApiError.badRequest('Empty file')
      if (bytes.byteLength > MAX_UPLOAD) throw ApiError.badRequest('文件超过 80MB')
      return Response.json({ base: await addDocument(id, url.searchParams.get('name') ?? 'document.txt', bytes) })
    }
    if (req.method === 'DELETE' && segments[5]) return Response.json({ base: removeDocument(id, decodeURIComponent(segments[5])) })
  } else if (action === 'search' && req.method === 'GET') {
    return Response.json({ hits: searchBase(id, (url.searchParams.get('q') ?? '').slice(0, 200)) })
  }
  throw ApiError.notFound('Unknown knowledge base endpoint')
}
